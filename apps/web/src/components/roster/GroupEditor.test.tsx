import type { TestProps, TestValue } from "../test-support/reactTree";
import { Predicate } from "effect";
import * as Cause from "effect/Cause";
import type { ReactElement } from "react";
import { BotId, EnvironmentId } from "@isnadi/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  locale: "en",
  assignMember: vi.fn(),
  unassignMember: vi.fn(),
  renameGroup: vi.fn(),
  setBoss: vi.fn(),
  setKeepBusy: vi.fn(),
  deleteGroup: vi.fn(),
  toast: vi.fn(),
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

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));

vi.mock("../../i18n", async () => {
  const { catalogRegistry, createTranslator } = await import("@isnadi/client-runtime/i18n");

  const translators = {
    en: createTranslator("en"),
    "zh-CN": createTranslator("zh-CN", await catalogRegistry["zh-CN"]!()),
  };

  return { useI18n: () => (mocks.locale === "zh-CN" ? translators["zh-CN"] : translators.en) };
});

vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: () => Promise.resolve(true) } }),
}));

vi.mock("../../state/bots", () => ({
  botEnvironment: {
    groups: {
      rename: "rename",
      delete: "delete",
      assignMember: "assignMember",
      unassignMember: "unassignMember",
      setBoss: "setBoss",
      setKeepBusy: "setKeepBusy",
    },
  },
}));

vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: () => "snapshot" }));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) => {
    switch (command) {
      case "assignMember":
        return mocks.assignMember;
      case "unassignMember":
        return mocks.unassignMember;
      case "rename":
        return mocks.renameGroup;
      case "setBoss":
        return mocks.setBoss;
      case "setKeepBusy":
        return mocks.setKeepBusy;
      default:
        return mocks.deleteGroup;
    }
  },
}));

vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));

import { reactHookHarness } from "../../test/reactHookHarness";
import { visitElements } from "../test-support/reactTree";
import { GroupEditor } from "./GroupEditor";
import type { Bot, Group } from "./types";

const environmentId = EnvironmentId.make("environment-1");

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

const boss = bot("bot-mira", "Mira");

const scout = bot("bot-scout", "Scout");

const patch = bot("bot-patch", "Patch");

/** Not in the group, so the editor offers it in the add control. */
const newcomer = { ...bot("bot-nim", "Nim"), groupId: null };

const group: Group = {
  id: "group-1",
  name: "Ops",
  bossBotId: boss.id,
  members: [
    { kind: "bot", botId: BotId.make(boss.id), role: "boss" },
    { kind: "bot", botId: BotId.make(scout.id), role: "specialist" },
    { kind: "bot", botId: BotId.make(patch.id), role: "specialist" },
  ],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** The server refusal a coded throw becomes once the cause is squashed. */
const refusal = (code: string, message: string) => Cause.fail({ refusal: code, message });

const editor = () => {
  reactHookHarness.beginRender();

  return GroupEditor({
    environmentId,
    group,
    bots: [boss, scout, patch, newcomer],
    onDeleted: vi.fn(),
  }) as ReactElement<TestProps>;
};

function findByLabel(node: TestValue, label: string): ReactElement<TestProps> | null {
  return visitElements(node, (element) => element.props["aria-label"] === label);
}

/** Clicks a control and lets the awaited command result settle. */
async function click(control: ReactElement<TestProps> | null) {
  await (control?.props.onClick as (() => Promise<void> | void) | undefined)?.();
  // The handler fires the command with `void`, so its continuation runs one
  // microtask after the click returns.
  await Promise.resolve();
}

/** Picks a bot in the add control, the way a user must before the button works. */
function chooseNewMember(botId: string) {
  const select = visitElements(
    editor(),
    (element) => Predicate.isFunction(element.props.onValueChange) && element.props.value === "",
  );

  const onValueChange = select?.props.onValueChange;

  if (Predicate.isFunction(onValueChange)) {
    (onValueChange as (value: string) => void)(botId);
  }
}

/**
 * The add control, found by size rather than aria-label: the label is
 * translated, and one of the cases below runs the editor in another locale.
 */
function addButton() {
  return visitElements(
    editor(),
    (element) => element.props.size === "icon" && Predicate.isFunction(element.props.onClick),
  );
}

async function clickAdd() {
  chooseNewMember(newcomer.id);
  await click(addButton());
}

describe("GroupEditor member change refusals", () => {
  beforeEach(() => {
    reactHookHarness.reset();
    mocks.locale = "en";

    for (const mock of [
      mocks.assignMember,
      mocks.unassignMember,
      mocks.renameGroup,
      mocks.setBoss,
      mocks.setKeepBusy,
      mocks.deleteGroup,
      mocks.toast,
    ]) {
      mock.mockReset();
    }
  });

  it("names why an added bot was refused instead of showing the title alone", async () => {
    mocks.assignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal(
        "group-already-has-boss",
        "Group 'group-1' already has boss bot 'bot-mira'. Use 'group.boss.set' to replace it.",
      ),
    });

    await clickAdd();

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not add bot",
      description:
        "This space already has a boss. Replace the boss before making this bot the boss.",
    });
  });

  it("names why a removed bot was refused instead of showing the title alone", async () => {
    mocks.unassignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal(
        "bot-not-a-group-member",
        "Bot 'bot-scout' is not a member of group 'group-1'.",
      ),
    });

    await click(findByLabel(editor(), "Remove Scout from Ops"));

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not remove Scout",
      description: "That bot is no longer in this space. Refresh to see the current team.",
    });
  });

  it("keeps the shipped copy for the codes these two commands reuse", async () => {
    mocks.unassignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal("bot-is-group-boss", "Bot 'bot-mira' is the last boss of group 'group-1'."),
    });

    await click(findByLabel(editor(), "Remove Scout from Ops"));

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not remove Scout",
      description: "This bot leads a space. Pick a new boss, or delete the space.",
    });
  });

  it("explains an undersized space in words the user can act on", async () => {
    mocks.unassignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal(
        "group-would-be-undersized",
        "Group 'group-1' requires at least two active bots.",
      ),
    });

    await click(findByLabel(editor(), "Remove Scout from Ops"));

    expect(mocks.toast).toHaveBeenCalledWith({
      type: "error",
      title: "Could not remove Scout",
      description: "This space needs at least two bots. Add another bot before you remove one.",
    });
  });

  it("never renders an internal id for either command", async () => {
    mocks.assignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal(
        "group-already-has-boss",
        "Group 'group-1' already has boss bot 'bot-mira'. Use 'group.boss.set' to replace it.",
      ),
    });
    mocks.unassignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal(
        "bot-not-a-group-member",
        "Bot 'bot-scout' is not a member of group 'group-1'.",
      ),
    });

    await clickAdd();
    await click(findByLabel(editor(), "Remove Scout from Ops"));

    for (const [toast] of mocks.toast.mock.calls) {
      expect(toast.description).not.toContain("group-1");
      expect(toast.description).not.toContain("bot-mira");
      expect(toast.description).not.toContain("bot-scout");
    }
  });

  it("renders the refusal in the reader's own locale", async () => {
    mocks.locale = "zh-CN";
    mocks.assignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal("group-already-has-boss", "Group 'group-1' already has boss bot 'bot-mira'."),
    });

    await clickAdd();

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "此空间已有主管。请先更换主管，再将该机器人设为主管。",
      }),
    );
  });

  it("keeps the server sentence for a code this client does not know", async () => {
    mocks.assignMember.mockResolvedValue({
      _tag: "Failure",
      cause: refusal("quota-exceeded", "Quota reached."),
    });

    await clickAdd();

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Quota reached." }),
    );
  });

  it("leaves rename on its title-only toast, because its refusals are still uncoded", async () => {
    mocks.renameGroup.mockResolvedValue({
      _tag: "Failure",
      cause: Cause.fail(new Error("Group 'group-1' does not exist.")),
    });

    const save = visitElements(
      editor(),
      (element) => Predicate.isFunction(element.type) && element.props.children === "Save",
    );

    await click(save);

    // Migrating this call site would echo the server's own sentence, raw group
    // id included. Only the two member commands opt in to the description.
    expect(mocks.toast).toHaveBeenCalledWith({ type: "error", title: "Could not rename group" });
    expect(mocks.toast.mock.calls[0]?.[0]).not.toHaveProperty("description");
  });
});
