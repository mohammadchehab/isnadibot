import { describe, expect, it } from "vite-plus/test";

import {
  BotId,
  ThreadId,
  TurnId,
  WorkItemId,
  type OrchestrationLatestTurn,
  type WorkItemState,
} from "@isnadi/contracts";
import type { BotStatusChat } from "@isnadi/shared/botStatus";

import { buildCapacity, type CapacityBot, type CapacityWorkItem } from "./capacity.ts";

const BOSS = BotId.make("boss");

const ENGINEER = BotId.make("engineer");

const DESIGNER = BotId.make("designer");

const ELSEWHERE = BotId.make("another-environment-bot");

const NOW = "2026-11-13T10:00:00.000Z";

const RUNNING: OrchestrationLatestTurn = {
  turnId: TurnId.make("turn-1"),
  state: "running",
  requestedAt: NOW,
  startedAt: NOW,
  completedAt: null,
  assistantMessageId: null,
};

function bot(id: BotId, name: string, archivedAt: string | null = null): CapacityBot {
  return { id, name, archivedAt };
}

function chat(overrides: Partial<BotStatusChat> = {}): BotStatusChat {
  return {
    id: ThreadId.make("chat-1"),
    botId: BOSS,
    respondingBotId: null,
    parentThreadId: null,
    archivedAt: null,
    latestTurn: null,
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

function item(
  id: string,
  ownerBotId: BotId,
  state: WorkItemState,
  createdAt = NOW,
): CapacityWorkItem {
  return { id: WorkItemId.make(id), ownerBotId, state, createdAt, title: `Item ${id}` };
}

const ROSTER: ReadonlyArray<CapacityBot> = [
  bot(ENGINEER, "Engineer"),
  bot(BOSS, "Boss"),
  bot(DESIGNER, "Designer"),
];

describe("buildCapacity", () => {
  it("puts the boss first, keeps roster order for the rest and drops archived bots", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: [...ROSTER, bot(BotId.make("gone"), "Gone", NOW)],
      chats: [],
      workItems: [],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    expect(capacity.rows.map((row) => row.name)).toEqual(["Boss", "Engineer", "Designer"]);
    expect(capacity.rows.map((row) => row.isBoss)).toEqual([true, false, false]);
  });

  it("falls back to roster order when the group has no boss", () => {
    const capacity = buildCapacity({
      bossBotId: null,
      bots: ROSTER,
      chats: [],
      workItems: [],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    expect(capacity.rows.map((row) => row.name)).toEqual(["Engineer", "Boss", "Designer"]);
    expect(capacity.rows.every((row) => !row.isBoss)).toBe(true);
  });

  it("reads each bot's state with the asking > held > busy > idle precedence", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [
        chat({ id: ThreadId.make("c-boss"), botId: BOSS, hasPendingUserInput: true }),
        chat({ id: ThreadId.make("c-eng"), botId: ENGINEER, latestTurn: RUNNING }),
      ],
      workItems: [item("w-1", ENGINEER, "blocked"), item("w-2", DESIGNER, "queued")],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    expect(capacity.rows.map((row) => row.status)).toEqual(["asking", "held", "idle"]);
    expect(capacity.counts).toEqual({
      asking: 1,
      "sign-in-required": 0,
      held: 1,
      busy: 0,
      idle: 1,
    });
  });

  it("ignores an archived chat when it decides what a bot is doing", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [chat({ archivedAt: NOW, latestTurn: RUNNING })],
      workItems: [],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    expect(capacity.rows[0]?.status).toBe("idle");
  });

  it("shows the item a bot is on and counts the rest", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [],
      workItems: [
        item("w-old", ENGINEER, "assigned", "2026-11-01T10:00:00.000Z"),
        item("w-live", ENGINEER, "in-progress", "2026-11-05T10:00:00.000Z"),
        item("w-new", ENGINEER, "queued", "2026-11-10T10:00:00.000Z"),
        item("w-done", ENGINEER, "done", "2026-11-02T10:00:00.000Z"),
      ],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    const engineer = capacity.rows.find((row) => row.botId === ENGINEER);

    expect(engineer?.item).toEqual({ id: "w-live", title: "Item w-live", extra: 2 });
  });

  it("falls back to the oldest open item when the bot is not on one", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [],
      workItems: [
        item("w-new", DESIGNER, "queued", "2026-11-10T10:00:00.000Z"),
        item("w-old", DESIGNER, "assigned", "2026-11-01T10:00:00.000Z"),
      ],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    const designer = capacity.rows.find((row) => row.botId === DESIGNER);

    expect(designer?.item).toEqual({ id: "w-old", title: "Item w-old", extra: 1 });
  });

  it("leaves an item owned by a bot outside this group off every row", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [],
      workItems: [item("w-elsewhere", ELSEWHERE, "in-progress")],
      delegations: [],
      contextPercentByBotId: new Map(),
      queuedByBotId: new Map(),
    });

    expect(capacity.rows.every((row) => row.item === null)).toBe(true);
  });

  it("shows context and queue only where the caller has a reading", () => {
    const capacity = buildCapacity({
      bossBotId: BOSS,
      bots: ROSTER,
      chats: [],
      workItems: [],
      delegations: [],
      contextPercentByBotId: new Map([[BOSS, 42]]),
      queuedByBotId: new Map([[ENGINEER, 2]]),
    });

    expect(capacity.rows[0]?.contextPercent).toBe(42);
    expect(capacity.rows[0]?.queued).toBe(0);
    expect(capacity.rows[1]?.contextPercent).toBeNull();
    expect(capacity.rows[1]?.queued).toBe(2);
  });
});
