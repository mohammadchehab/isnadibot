import { BotId, EnvironmentId, ThreadId } from "@isnadi/contracts";
import type { Decision } from "@isnadi/client-runtime/decisions";
import { scopeThreadShell } from "@isnadi/client-runtime/state/models";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";
import { makeShellSnapshot } from "../test-support/fixtures";

const ENVIRONMENT = EnvironmentId.make("environment-1");

const BOT_ID = BotId.make("bot-1");

const mocks = vi.hoisted(() => ({
  decisions: [] as ReadonlyArray<Decision>,
  threads: [] as ReadonlyArray<{ id: string; title: string; updatedAt: string; waiting: boolean }>,
  bots: [] as ReadonlyArray<Bot>,
  usage: { turns: 0, isPending: false, hasError: false },
  openChat: vi.fn(),
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
  useThreadShells: () =>
    makeShellSnapshot({
      threads: mocks.threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        botId: "bot-1",
        groupId: "g1",
        updatedAt: thread.updatedAt,
        hasPendingApprovals: thread.waiting,
      })),
    }).threads.map((thread) => scopeThreadShell(ENVIRONMENT, thread)),
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => ENVIRONMENT }));

vi.mock("../../state/environmentSnapshot", () => ({ useEnvironmentSnapshot: () => null }));

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

const render = () => renderToStaticMarkup(<SpaceOverview group={group} />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.decisions = [];
  mocks.threads = [];
  mocks.bots = [ada];
  mocks.usage = { turns: 0, isPending: false, hasError: false };
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
});
