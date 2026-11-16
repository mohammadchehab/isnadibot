import type { TestProps, TestValue } from "../test-support/reactTree";
import { decodeServerProvider } from "../test-support/fixtures";
import { Predicate } from "effect";
import { isValidElement, type ReactElement } from "react";
import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@isnadi/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../test-support/reactTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import type { Bot } from "./types";

const atoms = vi.hoisted(() => ({
  providers: Symbol("providers"),
  mcpServers: Symbol("mcpServers"),
  groups: Symbol("environmentGroups"),
  update: Symbol("botUpdate"),
}));

const state = vi.hoisted(() => ({
  bots: [] as Bot[],
  providers: [] as ServerProvider[],
  updateBot: vi.fn(),
  requestConfirmDialog: vi.fn(),
}));

/** The blocker the form registers, captured so a test can ask it about navigation. */
const blocker = vi.hoisted(() => ({
  options: null as null | {
    readonly shouldBlockFn: () => Promise<boolean>;
    readonly disabled: boolean;
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: reactHookHarness.useEffect,
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("@tanstack/react-router", () => ({
  useBlocker: (options: typeof blocker.options) => {
    blocker.options = options;
  },
  useCanGoBack: () => false,
  useNavigate: () => vi.fn(),
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: symbol) => (atom === atoms.providers ? state.providers : []),
}));

vi.mock("../../state/server", () => ({
  primaryServerProvidersAtom: atoms.providers,
  serverEnvironment: {
    imageProviders: () => Symbol("imageProviders"),
    subscriptionAuth: () => Symbol("subscriptionAuth"),
  },
}));

vi.mock("../../state/mcpServers", () => ({ environmentMcpServersAtom: () => atoms.mcpServers }));

vi.mock("../../state/bots", () => ({
  botEnvironment: { update: atoms.update, delete: Symbol("botDelete") },
  environmentGroupsAtom: () => atoms.groups,
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-1"),
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => (atom === atoms.update ? state.updateBot : vi.fn()),
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, isPending: true, refresh: vi.fn() }),
}));

vi.mock("../../hooks/useSettings", () => ({
  usePrimarySettings: () => DEFAULT_UNIFIED_SETTINGS,
  useEnvironmentSettings: <T,>(
    _environmentId: EnvironmentId,
    selector: (settings: typeof DEFAULT_UNIFIED_SETTINGS) => T,
  ) => selector(DEFAULT_UNIFIED_SETTINGS),
}));

vi.mock("./rosterStore", () => ({
  useRosterStore: <T,>(selector: (store: { bots: Bot[] }) => T) => selector({ bots: state.bots }),
}));

vi.mock("./useBotThreadRef", () => ({ useBotThreadRef: () => null }));

vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

vi.mock("../../confirmDialog", () => ({ requestConfirmDialog: state.requestConfirmDialog }));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useI18n: () => ({ ...translator, t: translator.translate }) };
});

import { BotSettingsPage } from "./BotSettingsPage";
import { expandBotSettingsSections } from "./BotSettingsPage.test-support";

const codexId = ProviderInstanceId.make("codex");

type Tree = ReactElement<TestProps>;

function codexProvider(): ServerProvider {
  return decodeServerProvider({
    instanceId: codexId,
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-01T00:00:00.000Z",
    models: [
      { slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null },
      { slug: "gpt-5-mini", name: "GPT-5 mini", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  });
}

/**
 * A specialist as the fleet hire creates one: no sandbox choice, no label, no
 * tone, and an engine the squad setup picked.
 */
function makeHiredBot(overrides: Partial<Bot> = {}): Bot {
  return {
    id: "bot-1",
    name: "Planner",
    title: "Planner",
    label: null,
    description: "Plans the work and assigns it",
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "hex", color: "#2E8EFF" },
    engine: { provider: codexId, model: "gpt-5", fallbacks: [] },
    sandbox: null,
    runtimeMode: "full-access",
    voiceEnabled: false,
    imageProvider: null,
    groupId: null,
    pinned: false,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Renders the page, then the form it mounts, then the form's section leaves,
 * and runs the effects that render queued — the pass React would make.
 */
function renderPage(): Tree {
  hooks.beginRender();
  const page = BotSettingsPage({ botId: "bot-1" }) as Tree;

  const formElement = visitElements(
    page,
    (element) => Predicate.isFunction(element.props.onSave) && "bot" in element.props,
  );

  expect(formElement).not.toBeNull();

  const Form = formElement!.type as (props: TestProps) => Tree;
  const tree = expandBotSettingsSections(Form(formElement!.props));

  hooks.flushEffects();

  return tree;
}

function textOf(node: TestValue): string {
  if (Predicate.isString(node) || Predicate.isNumber(node)) return String(node);

  if (Array.isArray(node)) return node.map(textOf).join("");

  if (isValidElement<Tree["props"]>(node)) return textOf((node as Tree).props.children);

  return "";
}

/** What the save bar's status line says: the two words the user reads, or nothing. */
function saveBarText(tree: Tree): string {
  const status = visitElements(tree, (element) => element.props["aria-live"] === "polite");

  expect(status).not.toBeNull();

  return textOf(status!.props.children).trim();
}

function sandboxSelect(tree: Tree): { readonly value: string; onValueChange: (v: string) => void } {
  const select = visitElements(
    tree,
    (element) =>
      Predicate.isFunction(element.props.onValueChange) &&
      visitElements(
        element.props.children,
        (child) => child.props["aria-label"] === "Sandbox provider",
      ) !== null,
  );

  expect(select).not.toBeNull();

  return select!.props as {
    readonly value: string;
    readonly onValueChange: (value: string) => void;
  };
}

function saveButton(tree: Tree): { readonly disabled: boolean; onClick: () => void } {
  const button = visitElements(
    tree,
    (element) => element.props.onClick !== undefined && textOf(element.props.children) === "Save",
  );

  expect(button).not.toBeNull();

  return button!.props as { readonly disabled: boolean; readonly onClick: () => void };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

/**
 * The projection landing: the command's payload becomes the bot the roster
 * serves, the way `bot.updated` reaches the client.
 */
function project(update: TestProps): void {
  const { botId: _botId, ...profile } = update;

  state.bots = state.bots.map((bot) =>
    bot.id === update["botId"]
      ? { ...bot, ...(profile as Partial<Bot>), updatedAt: "2026-09-01T00:01:00.000Z" }
      : bot,
  );
}

beforeEach(() => {
  hooks.reset();
  vi.clearAllMocks();
  state.bots = [makeHiredBot()];
  state.providers = [codexProvider()];
  state.updateBot.mockReset().mockResolvedValue({ _tag: "Success" });
  state.requestConfirmDialog.mockReset().mockResolvedValue(false);
  blocker.options = null;
  vi.stubGlobal("window", {
    addEventListener() {},
    removeEventListener() {},
  });
});

describe("bot settings unsaved guard", () => {
  it("stops guarding the page once the save lands", async () => {
    // Starting clean is the premise: a hired bot is not already dirty.
    expect(saveBarText(renderPage())).toBe("");

    const chosen = renderPage();
    expect(sandboxSelect(chosen).value).toBe("default");
    sandboxSelect(chosen).onValueChange("local");

    const edited = renderPage();
    expect(saveBarText(edited)).toBe("Unsaved changes");
    expect(saveButton(edited).disabled).toBe(false);

    saveButton(edited).onClick();
    await flushPromises();

    // The command is accepted; the roster has not caught up yet.
    expect(state.updateBot).toHaveBeenCalledTimes(1);
    const [command] = state.updateBot.mock.calls[0] as [{ input: TestProps }];
    expect(command.input["sandbox"]).toBe("local");

    // The window the bug lives in: the save succeeded, the projection has not
    // landed. The page says "Saved", so leaving must not ask about changes.
    const accepted = renderPage();
    expect(saveBarText(accepted)).toBe("Saved");
    await expect(blocker.options!.shouldBlockFn()).resolves.toBe(false);
    expect(state.requestConfirmDialog).not.toHaveBeenCalled();

    project(command.input);
    const saved = renderPage();

    expect(saveBarText(saved)).toBe("Saved");
    expect(blocker.options?.disabled).toBe(true);
    await expect(blocker.options!.shouldBlockFn()).resolves.toBe(false);
    expect(state.requestConfirmDialog).not.toHaveBeenCalled();
  });

  it("still asks before dropping a change made after the save", async () => {
    const edited = renderPage();
    sandboxSelect(edited).onValueChange("local");
    const changed = renderPage();

    saveButton(changed).onClick();
    await flushPromises();

    const [command] = state.updateBot.mock.calls[0] as [{ input: TestProps }];
    project(command.input);
    renderPage();

    const again = renderPage();
    sandboxSelect(again).onValueChange("e2b");
    const dirtyAgain = renderPage();

    expect(saveBarText(dirtyAgain)).toBe("Unsaved changes");
    expect(blocker.options?.disabled).toBe(false);
    await expect(blocker.options!.shouldBlockFn()).resolves.toBe(true);
    expect(state.requestConfirmDialog).toHaveBeenCalledWith(
      "Discard unsaved bot settings?",
      expect.objectContaining({ variant: "destructive" }),
    );
  });
});
