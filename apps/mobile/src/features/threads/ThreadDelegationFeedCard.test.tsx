import { makeMobileBot } from "../../lib/mobile-fixtures.test-support";
import { BotId, DelegationId, ThreadId, TurnId } from "@isnadi/contracts";
import type {
  ApprovalRequestId,
  EnvironmentId,
  IsnadiDelegationRecord,
  ScopedThreadRef,
} from "@isnadi/contracts";
import type { PendingApproval } from "../../lib/threadActivity";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { delegationActions } from "@isnadi/client-runtime/delegation-presentation";
import { ThreadDelegationFeedCard } from "./ThreadDelegationFeedCard";

const environmentId = "env-1" as EnvironmentId;

// The feed card reads the environment's delegation list through an atom and each
// nested approval through its own hook, so both are stood in for here: what the
// test proves is which records the card reaches for, not how atoms resolve.
const feed = vi.hoisted(() => ({
  delegations: [] as ReadonlyArray<IsnadiDelegationRecord>,
  approvalsByThreadId: new Map<string, PendingApproval>(),
}));

vi.mock("@effect/atom-react", () => ({
  // The mocked atom family below hands back the delegation list itself.
  useAtomValue: (delegations: ReadonlyArray<IsnadiDelegationRecord>) => delegations,
}));

vi.mock("../../state/delegations", () => ({
  environmentDelegationsAtom: () => feed.delegations,
}));

vi.mock("./useChildThreadApproval", () => ({
  useChildThreadApproval: (threadRef: ScopedThreadRef | null) => ({
    pendingApproval:
      threadRef === null ? null : (feed.approvalsByThreadId.get(threadRef.threadId) ?? null),
    respondingApprovalId: null,
    respond: async () => undefined,
  }),
}));

vi.mock("../../state/orchestration", () => ({
  orchestrationEnvironment: { cancelDelegation: {}, retryDelegation: {} },
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success" }),
}));

vi.mock("react-native", () => ({
  Alert: { alert: () => undefined },
  Text: "span",
  View: "div",
  Pressable: (props: { readonly children?: ReactNode }) =>
    createElement("button", null, props.children),
}));

vi.mock("../../components/AppText", () => ({
  AppText: (props: { children?: ReactNode }) => createElement("span", null, props.children),
}));

vi.mock("../../components/BotAvatarView", () => ({
  BotAvatarView: () => createElement("span", { "data-avatar": true }),
  seededBlobAvatar: () => ({ kind: "blob", shape: "circle", color: "#8E8E93" }),
}));

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ ...translator, t: translator.translate }) };
});

const running = (childThreadId: string): IsnadiDelegationRecord["phase"] => ({
  _tag: "Running",
  childThreadId: ThreadId.make(childThreadId),
  childTurnId: null,
  startedAt: "2026-09-25T10:00:30.000Z",
  progress: null,
});

const completed = (childThreadId: string): IsnadiDelegationRecord["phase"] => ({
  _tag: "Completed",
  childThreadId: ThreadId.make(childThreadId),
  childTurnId: null,
  startedAt: "2026-09-25T10:00:30.000Z",
  completedAt: "2026-09-25T10:05:00.000Z",
  result: { summary: "Done.", childThreadId: ThreadId.make(childThreadId), childTurnId: null },
  acknowledgedAt: null,
});

const delegation = (input: {
  readonly id: string;
  readonly parentThreadId: string;
  readonly childBotId: string;
  readonly depth: number;
  readonly phase: IsnadiDelegationRecord["phase"];
}): IsnadiDelegationRecord => ({
  delegationId: DelegationId.make(input.id),
  parentDelegationId: null,
  parentBotId: BotId.make("bot-parent"),
  childBotId: BotId.make(input.childBotId),
  parentThreadId: ThreadId.make(input.parentThreadId),
  parentTurnId: TurnId.make("turn-1"),
  ancestorBotIds: [BotId.make("bot-parent")],
  depth: input.depth,
  task: "Compare three flights.",
  expectedResult: "A short comparison.",
  deadline: null,
  access: {
    allowedToolIds: [],
    memoryScopes: [],
    sandbox: null,
    runtimeMode: "approval-required",
    hasUserComputer: false,
    enabledMcpServerIds: [],
    disabledMcpServerIds: [],
    approvalCeiling: "none",
  },
  billedBotId: BotId.make(input.childBotId),
  keep: false,
  anchorMessageId: null,
  retryOfDelegationId: null,
  trigger: "bot",
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  phase: input.phase,
});

// The card's own delegation: the chat that asked for the depth-1 work.
const rootDelegation = delegation({
  id: "d-root",
  parentThreadId: "thread-root",
  childBotId: "bot-child",
  depth: 1,
  phase: running("thread-child"),
});

// Started by the child chat, so its approval has no card of its own anywhere.
const grandchildDelegation = delegation({
  id: "d-grandchild",
  parentThreadId: "thread-child",
  childBotId: "bot-grandchild",
  depth: 2,
  phase: running("thread-grandchild"),
});

const shellApproval: PendingApproval = {
  requestId: "req-shell" as ApprovalRequestId,
  requestKind: "command",
  createdAt: "2026-09-25T10:01:00.000Z",
  detail: "Run `npm test` in the workspace",
  appName: "Shell",
};

const botsById = new Map([
  ["bot-child", makeMobileBot({ id: BotId.make("bot-child"), name: "Scout", archivedAt: null })],
  [
    "bot-grandchild",
    makeMobileBot({ id: BotId.make("bot-grandchild"), name: "Runner", archivedAt: null }),
  ],
]);

const markup = () =>
  renderToStaticMarkup(
    createElement(ThreadDelegationFeedCard, {
      environmentId,
      delegation: rootDelegation,
      actions: delegationActions(rootDelegation, [rootDelegation]),
      childBot: botsById.get("bot-child") ?? null,
      parentBot: null,
      botsById,
    }),
  );

describe("ThreadDelegationFeedCard", () => {
  beforeEach(() => {
    feed.delegations = [rootDelegation];
    feed.approvalsByThreadId.clear();
  });

  it("shows the card for its own delegation", () => {
    const html = markup();

    expect(html).toContain("Scout");
    expect(html).not.toContain("delegation-descendant-approval");
  });

  it("answers an approval raised two levels down from the card", () => {
    feed.delegations = [rootDelegation, grandchildDelegation];
    feed.approvalsByThreadId.set("thread-grandchild", shellApproval);

    const html = markup();

    expect(html).toContain("delegation-descendant-approval");
    expect(html).toContain("Runner needs an answer");
    expect(html).toContain("Run `npm test` in the workspace");
    expect(html).toContain("Allow once");
  });

  it("shows nothing for a nested delegation that is not asking anything", () => {
    feed.delegations = [rootDelegation, grandchildDelegation];

    expect(markup()).not.toContain("delegation-descendant-approval");
  });

  it("drops a stale approval once the nested work has finished", () => {
    const finished = { ...grandchildDelegation, phase: completed("thread-grandchild") };

    feed.delegations = [rootDelegation, finished];
    feed.approvalsByThreadId.set("thread-grandchild", shellApproval);

    expect(markup()).not.toContain("delegation-descendant-approval");
  });

  it("ignores a delegation from an unrelated chat", () => {
    const unrelated = delegation({
      id: "d-unrelated",
      parentThreadId: "thread-other",
      childBotId: "bot-grandchild",
      depth: 1,
      phase: running("thread-unrelated"),
    });

    feed.delegations = [rootDelegation, unrelated];
    feed.approvalsByThreadId.set("thread-unrelated", shellApproval);

    expect(markup()).not.toContain("delegation-descendant-approval");
  });
});
