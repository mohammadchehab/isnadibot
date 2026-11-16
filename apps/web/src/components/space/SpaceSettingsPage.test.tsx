import type { TestElement, TestProps, TestValue } from "../test-support/reactTree";
import * as NodeFS from "node:fs";
import { Predicate } from "effect";
import { isValidElement, type ReactNode } from "react";
import { BotId, EnvironmentId, GroupId } from "@isnadi/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";

const atoms = vi.hoisted(() => ({
  setBoss: Symbol("setBoss"),
  setKeepBusy: Symbol("setKeepBusy"),
}));

const state = vi.hoisted(() => ({
  bots: [] as Bot[],
  groups: [] as Group[],
  setBoss: vi.fn(),
  setKeepBusy: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: () => {},
    useId: () => "control-1",
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
  Link: ({ to, children }: { readonly to: string; readonly children?: ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  useCanGoBack: () => false,
  useNavigate: () => vi.fn(),
}));

vi.mock("../../state/bots", () => ({
  botEnvironment: { groups: { setBoss: atoms.setBoss, setKeepBusy: atoms.setKeepBusy } },
}));

vi.mock("../../state/environments", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-1"),
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => (atom === atoms.setBoss ? state.setBoss : state.setKeepBusy),
}));

vi.mock("../roster/rosterStore", () => ({
  useRosterStore: <T,>(selector: (store: { bots: Bot[]; groups: Group[] }) => T) =>
    selector({ bots: state.bots, groups: state.groups }),
}));

vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

vi.mock("../../i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");

  return { useI18n: () => createTranslator("en") };
});

import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../test-support/reactTree";
import { SpaceSettingsPage } from "./SpaceSettingsPage";

const bot = (id: string, name: string): Bot => ({
  id,
  name,
  title: name,
  label: null,
  description: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither", seed: id },
  engine: null,
  sandbox: "local",
  runtimeMode: "full-access",
  voiceEnabled: false,
  groupId: "group-1",
  pinned: false,
  archivedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const mira = bot("bot-mira", "Mira");

const scout = bot("bot-scout", "Scout");

const group = (bossBotId: string | null, members: ReadonlyArray<Bot>): Group => ({
  id: "group-1",
  name: "Launch",
  bossBotId,
  members: members.map((member) => ({
    kind: "bot",
    botId: BotId.make(member.id),
    role: member.id === bossBotId ? "boss" : "specialist",
  })),
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

/** Every string anywhere in the tree, including the copy held in props. */
function allText(node: TestValue): string {
  if (Predicate.isString(node) || Predicate.isNumber(node)) return String(node);

  if (Array.isArray(node)) return node.map(allText).join("\n");

  if (isValidElement<TestProps>(node)) {
    return Object.values(node.props).map(allText).join("\n");
  }

  return "";
}

function render(groupId = "group-1") {
  hooks.beginRender();

  return SpaceSettingsPage({ groupId });
}

const bossSelect = (tree: TestValue): TestElement | null =>
  visitElements(
    tree,
    (element) => Predicate.isFunction(element.props.onValueChange) && "disabled" in element.props,
  );

const keepBusySwitch = (tree: TestValue): TestElement | null =>
  visitElements(tree, (element) => element.props["aria-label"] === "Keep everyone busy");

function chooseBoss(tree: TestValue, botId: string) {
  const onValueChange = bossSelect(tree)?.props.onValueChange;

  if (!Predicate.isFunction(onValueChange)) throw new Error("the boss select is missing");

  (onValueChange as (value: string) => void)(botId);
}

function setKeepBusy(tree: TestValue, checked: boolean) {
  const onCheckedChange = keepBusySwitch(tree)?.props.onCheckedChange;

  if (!Predicate.isFunction(onCheckedChange)) throw new Error("the keep-busy switch is missing");

  (onCheckedChange as (value: boolean) => void)(checked);
}

beforeEach(() => {
  hooks.reset();
  state.bots = [mira, scout];
  state.groups = [group(mira.id, [mira, scout])];
  state.setBoss.mockReset();
  state.setKeepBusy.mockReset();
  state.setBoss.mockResolvedValue({ _tag: "Success" });
  state.setKeepBusy.mockResolvedValue({ _tag: "Success" });
});

describe("SpaceSettingsPage", () => {
  it("heads the page with the space name and its one-line status", () => {
    const text = allText(render());

    expect(text).toContain("Launch");
    expect(text).toContain("2 bots · Mira is the boss");
    expect(text).toContain("Work");
  });

  it("leaves both rows live when the space can hand work out", () => {
    const tree = render();

    expect(bossSelect(tree)?.props.disabled).toBe(false);
    expect(keepBusySwitch(tree)?.props.disabled).toBe(false);
  });

  it("disables the boss row and names the one control that fills it, with no bots", () => {
    state.groups = [group(null, [])];

    const tree = render();

    expect(bossSelect(tree)?.props.disabled).toBe(true);
    expect(allText(tree)).toContain("No bots yet");
    expect(allText(tree)).toContain("Add a bot to this space first.");
  });

  it("disables keep-busy until there is a boss to hand work to", () => {
    state.groups = [group(null, [mira, scout])];

    const tree = render();

    expect(keepBusySwitch(tree)?.props.disabled).toBe(true);
    expect(allText(tree)).toContain("Cards wait in the queue until a boss is chosen.");
  });

  it("says the space is gone instead of drawing rows for it", () => {
    const tree = render("group-that-was-deleted");

    expect(allText(tree)).toContain("This space is no longer available.");
    expect(bossSelect(tree)).toBeNull();
  });

  it("saves the boss through the typed group command", async () => {
    chooseBoss(render(), scout.id);
    // The handler fires the command with `void`, so its continuation runs one
    // microtask after the change returns.
    await Promise.resolve();

    expect(state.setBoss).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      input: {
        groupId: GroupId.make("group-1"),
        bossBotId: BotId.make(scout.id),
        unassignPreviousBoss: false,
      },
    });
  });

  it("turns keep-busy on through the typed group command", async () => {
    setKeepBusy(render(), true);
    await Promise.resolve();

    expect(state.setKeepBusy).toHaveBeenCalledWith({
      environmentId: EnvironmentId.make("environment-1"),
      input: { groupId: GroupId.make("group-1"), keepBusy: true },
    });
  });

  it("does nothing when the user re-picks the boss who is already the boss", async () => {
    chooseBoss(render(), mira.id);
    await Promise.resolve();

    expect(state.setBoss).not.toHaveBeenCalled();
  });
});

function read(relativePath: string): string {
  return NodeFS.readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("the ways into the page", () => {
  it("is a real route behind the same auth gate as the bot settings page", () => {
    const route = read("../../routes/groups.$groupId.settings.tsx");
    const tree = read("../../routeTree.gen.ts");

    expect(route).toContain('createFileRoute("/groups/$groupId/settings")');
    expect(route).toContain("<SpaceSettingsPage");
    expect(route).toContain("Route.useParams().groupId");
    expect(route).toContain('throw redirect({ to: "/pair", replace: true })');
    expect(tree).toContain("'/groups/$groupId/settings'");
    expect(tree).toContain("./routes/groups.$groupId.settings");
  });

  it("is reachable from the space's own header actions", () => {
    const view = read("./SpaceView.tsx");

    expect(view).toContain('aria-label={t("Space actions")}');
    expect(view).toContain('to: "/groups/$groupId/settings"');
    expect(view).toContain('t("Space settings")');
  });
});
