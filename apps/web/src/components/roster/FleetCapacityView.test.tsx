import {
  EnvironmentId,
  EventId,
  type OrchestrationThreadActivity,
  TurnId,
} from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { FleetCapacityView } from "./FleetCapacityView";

/**
 * The capacity view reads the shell snapshot and the activity stream and
 * nothing else. These fixtures stand in for both, so a test can change one field
 * of the snapshot and prove the rows follow without a refetch.
 */

type FixtureChat = {
  id: string;
  groupId: string | null;
  botId: string | null;
  respondingBotId: string | null;
  parentThreadId: string | null;
  archivedAt: string | null;
  updatedAt: string;
  latestTurn: { state: string } | null;
  session: { status: string } | null;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
};

type FixtureWorkItem = {
  id: string;
  title: string;
  state: string;
  ownerBotId: string;
  createdAt: string;
};

type FixtureSnapshot = {
  groups: Array<{
    id: string;
    bossBotId: string | null;
    fleetTemplateId: string | null;
    members: Array<{ kind: string; botId: string; role: string }>;
  }>;
  bots: Array<{ id: string; name: string; archivedAt: string | null }>;
  threads: ReadonlyArray<FixtureChat>;
  workItems: ReadonlyArray<FixtureWorkItem>;
  delegations: Array<{ parentThreadId: string; phase: string }>;
};

const fixtures = vi.hoisted(() => ({
  snapshot: {
    groups: [],
    bots: [],
    threads: [],
    workItems: [],
    delegations: [],
  } as FixtureSnapshot,
  activitiesByThreadId: new Map<string, Array<OrchestrationThreadActivity>>(),
  atomIds: [] as string[],
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => {
    fixtures.atomIds.push(atom);

    return fixtures.snapshot;
  },
}));

vi.mock("../../state/shell", () => ({ environmentSnapshotAtom: () => "environment-snapshot" }));

vi.mock("../../state/entities", () => ({
  useThreadActivities: (ref: { threadId: string } | null) =>
    ref === null ? [] : (fixtures.activitiesByThreadId.get(ref.threadId) ?? []),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (message: string, values?: Record<string, string | number>) => {
      let out = message;

      for (const [key, value] of Object.entries(values ?? {})) {
        out = out.replaceAll(`{${key}}`, String(value));
      }

      return out;
    },
  }),
}));

const BOSS = "bot-boss";

const ENGINEER = "bot-engineer";

const DESIGNER = "bot-designer";

function chat(overrides: Partial<FixtureChat> & { id: string }): FixtureChat {
  return {
    groupId: "group-fleet",
    botId: null,
    respondingBotId: null,
    parentThreadId: null,
    archivedAt: null,
    updatedAt: "2026-11-13T10:00:00.000Z",
    latestTurn: null,
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

function workItem(overrides: Partial<FixtureWorkItem> & { id: string }): FixtureWorkItem {
  return {
    title: "Wire the capacity view",
    state: "in-progress",
    ownerBotId: ENGINEER,
    createdAt: "2026-11-13T09:00:00.000Z",
    ...overrides,
  };
}

function installSnapshot({
  chats = [],
  workItems = [],
}: {
  chats?: ReadonlyArray<FixtureChat>;
  workItems?: ReadonlyArray<FixtureWorkItem>;
} = {}): void {
  fixtures.snapshot = {
    groups: [
      {
        id: "group-fleet",
        bossBotId: BOSS,
        fleetTemplateId: "template-squad",
        members: [
          { kind: "bot", botId: BOSS, role: "boss" },
          { kind: "bot", botId: ENGINEER, role: "specialist" },
          { kind: "bot", botId: DESIGNER, role: "specialist" },
        ],
      },
    ],
    bots: [
      { id: BOSS, name: "Leo bot", archivedAt: null },
      { id: ENGINEER, name: "Engineer", archivedAt: null },
      { id: DESIGNER, name: "Designer", archivedAt: "2026-11-01T00:00:00.000Z" },
    ],
    threads: chats,
    workItems,
    delegations: [],
  };
}

function render(): string {
  return renderToStaticMarkup(
    <FleetCapacityView
      environmentId={EnvironmentId.make("environment-1")}
      groupId="group-fleet"
      queuedByBotId={new Map([[ENGINEER, 2]])}
    />,
  );
}

/** The state each row reports, keyed by bot id: what the user actually reads. */
function rowStates(markup: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...markup.matchAll(/data-bot-id="([^"]+)" data-status="([^"]+)"/g)].flatMap((match) =>
      match[1] !== undefined && match[2] !== undefined ? [[match[1], match[2]]] : [],
    ),
  );
}

beforeEach(() => {
  fixtures.atomIds = [];
  fixtures.activitiesByThreadId.clear();
  installSnapshot();
});

describe("fleet capacity view", () => {
  it("renders one row per live member, the boss first", () => {
    const markup = render();

    expect(markup).toContain('data-testid="fleet-capacity"');
    expect(markup.match(/data-testid="fleet-capacity-row"/g)).toHaveLength(2);
    expect(markup).toContain("Leo bot");
    expect(markup).toContain("Engineer");
    expect(markup).not.toContain("Designer");
    expect(markup.indexOf("Leo bot")).toBeLessThan(markup.indexOf("Engineer"));
  });

  it("follows a turn from running to finished with no refetch", () => {
    installSnapshot({
      chats: [chat({ id: "chat-engineer", botId: ENGINEER, latestTurn: { state: "running" } })],
    });

    expect(rowStates(render())[ENGINEER]).toBe("busy");

    installSnapshot({
      chats: [chat({ id: "chat-engineer", botId: ENGINEER, latestTurn: { state: "finished" } })],
    });

    const settled = rowStates(render());

    expect(settled[ENGINEER]).toBe("idle");
    expect(settled[BOSS]).toBe("idle");
  });

  it("asks while an approval is open and settles once it is answered", () => {
    installSnapshot({
      chats: [
        chat({
          id: "chat-engineer",
          botId: ENGINEER,
          hasPendingApprovals: true,
          latestTurn: { state: "running" },
        }),
      ],
    });

    expect(rowStates(render())[ENGINEER]).toBe("asking");

    installSnapshot({
      chats: [
        chat({
          id: "chat-engineer",
          botId: ENGINEER,
          hasPendingApprovals: false,
          latestTurn: { state: "running" },
        }),
      ],
    });

    expect(rowStates(render())[ENGINEER]).toBe("busy");
  });

  it("holds a bot on a blocked item, then frees it when the item moves", () => {
    installSnapshot({ workItems: [workItem({ id: "item-1", state: "blocked" })] });

    expect(rowStates(render())[ENGINEER]).toBe("held");

    installSnapshot({ workItems: [workItem({ id: "item-1", state: "review" })] });

    expect(rowStates(render())[ENGINEER]).toBe("idle");
  });

  it("reads only the snapshot atom, never a second authority", () => {
    render();

    expect(fixtures.atomIds).toStrictEqual(["environment-snapshot"]);
  });

  it("shows the item, its overflow, the queue behind the bot and the context reading", () => {
    installSnapshot({
      chats: [
        chat({ id: "chat-boss", botId: BOSS, updatedAt: "2026-11-13T10:00:00.000Z" }),
        chat({ id: "chat-engineer", botId: ENGINEER, updatedAt: "2026-11-13T11:00:00.000Z" }),
      ],
      workItems: [
        workItem({ id: "item-1", state: "in-progress" }),
        workItem({ id: "item-2", title: "Second item", createdAt: "2026-11-13T09:30:00.000Z" }),
      ],
    });

    const contextActivity: OrchestrationThreadActivity = {
      id: EventId.make("activity-1"),
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: { usedTokens: 21_000, maxTokens: 100_000 },
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-11-13T11:00:00.000Z",
    };

    fixtures.activitiesByThreadId.set("chat-engineer", [contextActivity]);

    const markup = render();

    expect(markup).toContain("Wire the capacity view");
    expect(markup).toContain("+1");
    expect(markup).toContain("Queued (2)");
    expect(markup).toContain("21%");
    // The boss has a chat but no reading, and no item: two em dashes, no invented number.
    expect(markup).toContain("—");
  });
});
