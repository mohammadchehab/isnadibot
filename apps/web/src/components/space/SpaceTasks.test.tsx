import { BotId, EnvironmentId, GroupId, WorkItemId, type WorkItemSummary } from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";

const ENVIRONMENT = EnvironmentId.make("environment-1");

const BOT_ID = BotId.make("bot-1");

const GROUP_ID = GroupId.make("g1");

const refresh = vi.fn();

type FinishedState = "done" | "closed";

type QueryResult = {
  readonly data:
    | { readonly items: ReadonlyArray<WorkItemSummary>; readonly nextCursor: string | undefined }
    | undefined;
  readonly error: Error | null;
  readonly isPending: boolean;
};

const mocks = vi.hoisted(() => ({
  openItems: [] as ReadonlyArray<WorkItemSummary>,
  finished: {} as Record<"done" | "closed", QueryResult>,
  bots: [] as ReadonlyArray<Bot>,
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    formatNumber: (value: number) => String(value),
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => ENVIRONMENT }));

vi.mock("../../state/environmentSnapshot", () => ({
  useEnvironmentSnapshot: () => ({ workItems: mocks.openItems }),
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: { readonly finishedState: FinishedState } | null) =>
    atom === null
      ? { data: undefined, error: null, isPending: false, refresh }
      : mocks.finished[atom.finishedState],
}));

vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => async () => ({ _tag: "Success", value: undefined }),
}));

vi.mock("../../state/workItems", () => ({
  workItemEnvironment: {
    create: {},
    assign: {},
    update: {},
    close: {},
    reopen: {},
    item: () => ({ kind: "item" }),
    finished: ({ input }: { readonly input: { readonly state: FinishedState } }) => ({
      finishedState: input.state,
    }),
  },
}));

vi.mock("../roster/BotAvatarView", () => ({
  BotAvatarView: ({ name }: { readonly name: string }) => <span>{`avatar:${name}`}</span>,
}));

vi.mock("../roster/rosterStore", () => ({
  useRosterStore: (selector: (state: { bots: ReadonlyArray<Bot> }) => ReadonlyArray<Bot>) =>
    selector({ bots: mocks.bots }),
}));

vi.mock("./TaskDialog", () => ({ TaskDialog: () => null }));

import { SpaceTasks } from "./SpaceTasks";

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

const group: Group = {
  id: "g1",
  name: "Launch",
  bossBotId: "bot-1",
  members: [{ kind: "bot", botId: BOT_ID, role: "boss" }],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const card = ({
  id,
  ...overrides
}: Omit<Partial<WorkItemSummary>, "id"> & { readonly id: string }): WorkItemSummary => ({
  id: WorkItemId.make(id),
  groupId: GROUP_ID,
  title: `card ${id}`,
  kind: "task",
  state: "queued",
  briefPreview: "",
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  ...overrides,
});

const finishedPage = (items: ReadonlyArray<WorkItemSummary> = [], nextCursor?: string) => ({
  data: { items, nextCursor },
  error: null,
  isPending: false,
});

const render = () => renderToStaticMarkup(<SpaceTasks group={group} />);

const COLUMN_LABELS = ["New", "In progress", "Draft", "Closed", "Done"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openItems = [];
  mocks.bots = [ada];
  mocks.finished = { done: finishedPage(), closed: finishedPage() };
});

describe("SpaceTasks", () => {
  it("shows the five columns in the frame order", () => {
    const html = render();
    const positions = COLUMN_LABELS.map((label) => html.indexOf(`aria-label="${label}"`));

    for (const position of positions) expect(position).toBeGreaterThan(-1);

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("says what each empty column is waiting for", () => {
    const html = render();

    for (const copy of [
      "No new cards",
      "Nothing in progress",
      "Nothing in draft",
      "Nothing closed",
      "Nothing done",
    ])
      expect(html).toContain(copy);
  });

  it("keeps a blocked card in In progress under the note that blocks it", () => {
    mocks.openItems = [
      card({
        id: "blocked-1",
        title: "Wire the deploy key",
        state: "blocked",
        blockedOn: { by: "user", note: "Needs sign-in" },
      }),
    ];

    const html = render();

    expect(html).toContain("Wire the deploy key");
    expect(html).toContain("Needs sign-in");
    expect(html).not.toContain("Nothing in progress");
    expect(html).toContain("No new cards");
  });

  it("fills In progress and Draft from the open snapshot, not the paged read", () => {
    mocks.openItems = [
      card({ id: "doing-1", title: "Ship the board", state: "in-progress" }),
      card({ id: "review-1", title: "Read the diff", state: "review" }),
    ];

    const html = render();

    expect(html).toContain("Ship the board");
    expect(html).toContain("Read the diff");
    expect(html).not.toContain("Nothing in progress");
    expect(html).not.toContain("Nothing in draft");
  });

  it("fills Done from the paged read the shell cannot carry", () => {
    mocks.finished.done = finishedPage([
      card({ id: "done-1", title: "Land the tab", state: "done" }),
    ]);

    const html = render();

    expect(html).toContain("Land the tab");
    expect(html).not.toContain("Nothing done");
    expect(html).toContain("No new cards");
  });

  it("fills Closed from its own paged read, apart from Done", () => {
    mocks.finished.closed = finishedPage([
      card({ id: "closed-1", title: "Drop the old tab", state: "closed" }),
    ]);

    const html = render();

    expect(html).toContain("Drop the old tab");
    expect(html).not.toContain("Nothing closed");
    expect(html).toContain("Nothing done");
  });

  it("says how many recent cards the finished column shows when more are waiting", () => {
    mocks.finished.closed = finishedPage([card({ id: "closed-1", state: "closed" })], "cursor-1");

    expect(render()).toContain("Showing the 1 most recent.");
  });

  it("offers a retry when a finished column cannot load", () => {
    mocks.finished.done = { data: undefined, error: new Error("offline"), isPending: false };

    const html = render();

    expect(html).toContain("Could not load these cards");
    expect(html).toContain("Try again");
  });

  it("names the boss who assigns cards", () => {
    expect(render()).toContain("Ada assigns cards. They move when a bot finishes a step.");
  });

  it("names the card's owner, and says so when it has none", () => {
    mocks.openItems = [
      card({ id: "owned-1", title: "Owned", state: "in-progress", ownerBotId: BOT_ID }),
      card({ id: "free-1", title: "Free", state: "assigned" }),
    ];

    const html = render();

    expect(html).toContain("avatar:Ada");
    expect(html).toContain("No owner");
  });
});
