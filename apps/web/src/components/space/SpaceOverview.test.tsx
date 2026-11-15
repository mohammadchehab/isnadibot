import {
  BotId,
  DelegationId,
  EnvironmentId,
  ThreadId,
  TurnId,
  type IsnadiDelegationRecord,
} from "@isnadi/contracts";
import type { Decision } from "@isnadi/client-runtime/decisions";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";
import { makeShellSnapshot } from "../test-support/fixtures";

const ENVIRONMENT = EnvironmentId.make("environment-1");

const BOT_ID = BotId.make("bot-1");

const mocks = vi.hoisted(() => ({
  decisions: [] as ReadonlyArray<Decision>,
  threads: [] as ReadonlyArray<{
    id: string;
    title: string;
    updatedAt: string;
    waiting: boolean;
    parentThreadId?: string;
  }>,
  bots: [] as ReadonlyArray<Bot>,
  delegations: [] as ReadonlyArray<IsnadiDelegationRecord>,
  usage: { turns: 0, isPending: false, hasError: false },
  openChat: vi.fn(),
  snapshot: null as ReturnType<typeof makeShellSnapshot> | null,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    locale: "en-GB",
    formatNumber: (value: number) => String(value),
    plural: (count: number, forms: { one: string; other: string }) =>
      (count === 1 ? forms.one : forms.other).replace("{count}", String(count)),
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

vi.mock("../../state/botUsage", () => ({ useSpaceUsage: () => mocks.usage }));

vi.mock("@isnadi/client-runtime/routines", () => ({
  relativeRunTime: (value: string) => value,
  routineDateLabel: () => "",
}));

vi.mock("../../state/entities", () => ({
  useDecisions: () => mocks.decisions,
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => ENVIRONMENT }));

// The Overview reads the environment's own chats; the threads here stand in for them.
const activitySnapshot = () =>
  makeShellSnapshot({
    delegations: mocks.delegations,
    threads: mocks.threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      botId: "bot-1",
      groupId: "g1",
      updatedAt: thread.updatedAt,
      hasPendingApprovals: thread.waiting,
      ...(thread.parentThreadId === undefined ? {} : { parentThreadId: thread.parentThreadId }),
    })),
  });

vi.mock("../../state/environmentSnapshot", () => ({
  useEnvironmentSnapshot: () =>
    mocks.snapshot ?? (mocks.threads.length === 0 ? null : activitySnapshot()),
}));

vi.mock("../chat/useOpenChat", () => ({ useOpenChat: () => mocks.openChat }));

vi.mock("../roster/BotAvatarView", () => ({
  BotAvatarView: ({ name }: { name: string }) => <span>{`avatar:${name}`}</span>,
}));

vi.mock("../roster/useLocalDay", () => ({
  useLocalDay: () => new Date("2026-11-04T12:00:00.000Z"),
}));

vi.mock("../roster/rosterStore", () => ({
  useRosterStore: (selector: (state: { bots: ReadonlyArray<Bot> }) => ReadonlyArray<Bot>) =>
    selector({ bots: mocks.bots }),
}));

import { SpaceOverview } from "./SpaceOverview";

const group: Group = {
  id: "g1",
  name: "Launch",
  bossBotId: "bot-1",
  members: [{ kind: "bot", botId: BOT_ID, role: "boss" }],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const ada: Bot = {
  id: "bot-1",
  name: "Ada",
  title: "Engineer",
  label: null,
  description: null,
  disabledMcpServerIds: [],
  avatar: { kind: "blob", shape: "circle", color: "#2E8EFF" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: "g1",
  pinned: false,
  archivedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const decision = (threadId: string, title: string, updatedAt: string): Decision => ({
  environmentId: ENVIRONMENT,
  threadId: ThreadId.make(threadId),
  targetThreadId: ThreadId.make(`${threadId}-target`),
  botId: "bot-1",
  groupId: "g1",
  title,
  kind: "approval",
  updatedAt,
});

const CHILD_THREAD = ThreadId.make("thread-child");

const CHILD_TURN = TurnId.make("turn-child");

const grace: Bot = {
  ...ada,
  id: "bot-2",
  name: "Grace",
  title: "Researcher",
};

/** A delegation record as the snapshot carries it, with the phase under test supplied. */
const delegationRecord = (
  phase: IsnadiDelegationRecord["phase"],
  overrides: Partial<IsnadiDelegationRecord> = {},
): IsnadiDelegationRecord => ({
  delegationId: DelegationId.make(`delegation-${phase._tag}`),
  parentDelegationId: null,
  parentBotId: BotId.make("bot-1"),
  childBotId: BotId.make("bot-2"),
  parentThreadId: ThreadId.make("thread-1"),
  parentTurnId: TurnId.make("turn-parent"),
  ancestorBotIds: [BotId.make("bot-1")],
  depth: 1,
  task: "Compare three flights.",
  expectedResult: "A short comparison.",
  deadline: null,
  access: {
    allowedToolIds: [],
    memoryScopes: [],
    sandbox: "local",
    runtimeMode: "approval-required",
    hasUserComputer: false,
    enabledMcpServerIds: [],
    disabledMcpServerIds: [],
    approvalCeiling: "send",
  },
  billedBotId: BotId.make("bot-2"),
  keep: false,
  anchorMessageId: null,
  retryOfDelegationId: null,
  trigger: "bot",
  createdAt: "2026-11-03T10:00:00.000Z",
  updatedAt: "2026-11-03T11:00:00.000Z",
  phase,
  ...overrides,
});

const render = () => renderToStaticMarkup(<SpaceOverview group={group} />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decisions = [];
  mocks.threads = [];
  mocks.bots = [ada];
  mocks.delegations = [];
  mocks.usage = { turns: 0, isPending: false, hasError: false };
  mocks.snapshot = null;
});

describe("SpaceOverview", () => {
  it("shows the newest decision's line instead of a Review button", () => {
    mocks.decisions = [
      decision("t-new", "Deploy the launch post", "2026-11-03T10:00:00.000Z"),
      decision("t-old", "Approve the budget", "2026-11-02T10:00:00.000Z"),
    ];

    const html = render();

    expect(html).toContain("Deploy the launch post");
    expect(html).not.toContain("Approve the budget");
    expect(html).toContain("text-warning");
  });

  it("gives each activity row its bot's avatar and name", () => {
    mocks.threads = [
      { id: "thread-1", title: "chat one", updatedAt: "2026-11-03T10:00:00.000Z", waiting: false },
    ];

    const html = render();

    expect(html).toContain("avatar:Ada");
    expect(html).toContain("<bdi>Ada</bdi>");
    expect(html).toContain("chat one");
  });

  it("lists the work a bot did for the space, not only the space's own chat", () => {
    mocks.threads = [
      {
        id: "thread-1",
        title: "Build the todo app",
        updatedAt: "2026-11-03T10:00:00.000Z",
        waiting: false,
      },
      {
        id: "delegation-thread-2",
        title: "Bot work for Ada",
        updatedAt: "2026-11-03T11:00:00.000Z",
        waiting: false,
        parentThreadId: "thread-1",
      },
    ];

    const html = render();

    expect(html).toContain("Build the todo app");
    expect(html).toContain("Bot work for Ada");
  });

  it("gives a delegation one row carrying its task and state, not its child chat too", () => {
    mocks.bots = [ada, grace];
    mocks.threads = [
      {
        id: "thread-1",
        title: "Build the todo app",
        updatedAt: "2026-11-03T10:00:00.000Z",
        waiting: false,
      },
      {
        id: "thread-child",
        title: "Child chat the delegation ran",
        updatedAt: "2026-11-03T11:00:00.000Z",
        waiting: false,
        parentThreadId: "thread-1",
      },
    ];
    mocks.delegations = [
      delegationRecord({
        _tag: "Running",
        childThreadId: CHILD_THREAD,
        childTurnId: null,
        startedAt: "2026-11-03T10:30:00.000Z",
        progress: null,
      }),
    ];

    const html = render();

    // The delegation is the row: its task, the child bot, and the state it is in.
    expect(html).toContain("Compare three flights.");
    expect(html).toContain("avatar:Grace");
    // The state shares the meta line with the time rather than sitting in the row's
    // fixed-width right-hand zone, where it would take width from the task.
    expect(html).toContain("running · ");
    // Its child chat is the same work, so it does not get a second row.
    expect(html).not.toContain("Child chat the delegation ran");
    // The chat that started it is still listed.
    expect(html).toContain("Build the todo app");
  });

  it("offers Open on a delegation that has a child chat", () => {
    mocks.bots = [ada, grace];
    mocks.threads = [
      { id: "thread-1", title: "chat one", updatedAt: "2026-11-03T10:00:00.000Z", waiting: false },
    ];
    mocks.delegations = [
      delegationRecord({
        _tag: "Completed",
        childThreadId: CHILD_THREAD,
        childTurnId: null,
        startedAt: "2026-11-03T10:30:00.000Z",
        completedAt: "2026-11-03T11:00:00.000Z",
        acknowledgedAt: null,
        result: { summary: "Flight B.", childThreadId: CHILD_THREAD, childTurnId: CHILD_TURN },
      }),
    ];

    expect(render()).toContain("Open");
  });

  it("leaves Open off a queued delegation, which has no child chat yet", () => {
    mocks.bots = [ada, grace];
    mocks.threads = [
      { id: "thread-1", title: "chat one", updatedAt: "2026-11-03T10:00:00.000Z", waiting: false },
    ];
    mocks.delegations = [delegationRecord({ _tag: "Queued" })];

    const html = render();

    expect(html).toContain("queued");
    expect(html).not.toContain("Open");
  });

  it("offers Review only on a waiting row", () => {
    mocks.decisions = [decision("thread-1", "Ship it", "2026-11-03T10:00:00.000Z")];
    mocks.threads = [
      { id: "thread-1", title: "chat one", updatedAt: "2026-11-03T10:00:00.000Z", waiting: true },
      { id: "thread-2", title: "chat two", updatedAt: "2026-11-02T10:00:00.000Z", waiting: false },
    ];

    expect(render().match(/Review/g)).toHaveLength(1);

    mocks.decisions = [];
    mocks.threads = mocks.threads.map((thread) => ({ ...thread, waiting: false }));

    expect(render()).not.toContain("Review");
  });

  it("stamps the header with the newest item, not the group's own stamp", () => {
    mocks.decisions = [decision("thread-1", "Ship it", "2026-11-04T11:55:00.000Z")];

    const html = render();

    expect(html).toContain("updated 2026-11-04T11:55:00.000Z");
    expect(html).not.toContain(group.updatedAt);
  });

  it("counts the members' turns over the week and says so", () => {
    mocks.usage = { turns: 12, isPending: false, hasError: false };

    const html = render();

    expect(html).toContain("12 turns");
    expect(html).toContain("this week");
  });

  it("holds the total while a member has not answered", () => {
    mocks.usage = { turns: 3, isPending: true, hasError: false };

    expect(render()).toContain("…");
  });

  it("warns when a member could not report usage", () => {
    mocks.usage = { turns: 3, isPending: false, hasError: true };

    expect(render()).toContain("Some bots could not report usage");
  });

  it("puts the standup above the tiles once the snapshot arrives", () => {
    mocks.snapshot = makeShellSnapshot({
      bots: [{ id: "bot-1", name: "Ada" }],
      workItems: [
        {
          id: "w1",
          groupId: "g1",
          title: "Write the standup",
          kind: "task",
          briefPreview: "",
          state: "queued",
          createdAt: "2026-11-03T10:00:00.000Z",
          updatedAt: "2026-11-03T10:00:00.000Z",
        },
      ],
    });

    const html = render();

    expect(html).toContain('data-testid="space-standup"');
    expect(html).toContain("Write the standup");
    expect(html.indexOf("Standup")).toBeLessThan(html.indexOf("Activity"));
  });

  it("leaves the standup out until the snapshot arrives", () => {
    expect(render()).not.toContain('data-testid="space-standup"');
  });
});
