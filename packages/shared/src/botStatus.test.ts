import { describe, expect, it } from "vite-plus/test";

import {
  BotId,
  ThreadId,
  TurnId,
  type IsnadiDelegationPhase,
  type OrchestrationLatestTurn,
} from "@isnadi/contracts";

import {
  BOT_STATUSES,
  countBotStatuses,
  deriveBotStatus,
  type BotStatus,
  type BotStatusChat,
} from "./botStatus.ts";

const BOSS = BotId.make("boss");

const OTHER = BotId.make("other");

const NOW = "2026-11-13T10:00:00.000Z";

function chat(overrides: Partial<BotStatusChat> = {}): BotStatusChat {
  return {
    id: ThreadId.make("chat-1"),
    botId: BOSS,
    respondingBotId: null,
    parentThreadId: null,
    archivedAt: null,
    latestTurn: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

const RUNNING: OrchestrationLatestTurn = {
  turnId: TurnId.make("turn-1"),
  state: "running",
  requestedAt: NOW,
  startedAt: NOW,
  completedAt: null,
  assistantMessageId: null,
};

const COMPLETED: OrchestrationLatestTurn = {
  ...RUNNING,
  turnId: TurnId.make("turn-0"),
  state: "completed",
  completedAt: NOW,
};

const INTERRUPTED: OrchestrationLatestTurn = {
  ...RUNNING,
  turnId: TurnId.make("turn-i"),
  state: "interrupted",
  completedAt: NOW,
};

const ERRORED: OrchestrationLatestTurn = {
  ...RUNNING,
  turnId: TurnId.make("turn-e"),
  state: "error",
  completedAt: NOW,
};

const CHILD_RUNNING: IsnadiDelegationPhase = {
  _tag: "Running",
  childThreadId: ThreadId.make("child-1"),
  childTurnId: null,
  startedAt: NOW,
  progress: null,
};

const CHILD_DONE: IsnadiDelegationPhase = {
  _tag: "Completed",
  childThreadId: ThreadId.make("child-1"),
  childTurnId: null,
  startedAt: NOW,
  completedAt: NOW,
  result: "done",
  acknowledgedAt: null,
};

function status(input: {
  chats?: ReadonlyArray<BotStatusChat>;
  blockedItem?: boolean;
  delegations?: ReadonlyArray<{ parentThreadId: ThreadId; phase: IsnadiDelegationPhase }>;
  botId?: BotId;
}): BotStatus {
  return deriveBotStatus({
    botId: input.botId ?? BOSS,
    chats: input.chats ?? [],
    workItems:
      input.blockedItem === true
        ? [{ ownerBotId: input.botId ?? BOSS, state: "blocked" }]
        : [{ ownerBotId: input.botId ?? BOSS, state: "in-progress" }],
    delegations: input.delegations ?? [],
  });
}

describe("deriveBotStatus", () => {
  it("is idle when the bot has nothing at all", () => {
    expect(status({})).toBe("idle");
  });

  it("is busy only while a turn is running", () => {
    expect(status({ chats: [chat({ latestTurn: RUNNING })] })).toBe("busy");
  });

  it("is not busy for a turn that completed, was interrupted or errored", () => {
    for (const latestTurn of [COMPLETED, INTERRUPTED, ERRORED]) {
      expect(status({ chats: [chat({ latestTurn })] })).toBe("idle");
    }
  });

  it("is asking for a pending approval or a pending question", () => {
    expect(status({ chats: [chat({ latestTurn: RUNNING, hasPendingApprovals: true })] })).toBe(
      "asking",
    );
    expect(status({ chats: [chat({ latestTurn: RUNNING, hasPendingUserInput: true })] })).toBe(
      "asking",
    );
  });

  it("is held when it owns a blocked item, or when its turn waits on a child", () => {
    expect(status({ blockedItem: true })).toBe("held");
    expect(
      status({
        chats: [chat({ latestTurn: RUNNING })],
        delegations: [{ parentThreadId: ThreadId.make("chat-1"), phase: CHILD_RUNNING }],
      }),
    ).toBe("held");
  });

  it("is busy again once its delegated child has finished", () => {
    expect(
      status({
        chats: [chat({ latestTurn: RUNNING })],
        delegations: [{ parentThreadId: ThreadId.make("chat-1"), phase: CHILD_DONE }],
      }),
    ).toBe("busy");
  });

  it("applies the precedence asking, held, busy, idle", () => {
    // asking beats held, held beats busy.
    const all = {
      chats: [chat({ latestTurn: RUNNING, hasPendingUserInput: true })],
      blockedItem: true,
      delegations: [{ parentThreadId: ThreadId.make("chat-1"), phase: CHILD_RUNNING }],
    };

    expect(status(all)).toBe("asking");
    expect(status({ ...all, chats: [chat({ latestTurn: RUNNING })] })).toBe("held");
    expect(status({ ...all, chats: [chat({ latestTurn: RUNNING })], blockedItem: false })).toBe(
      "held",
    );
    expect(
      status({ chats: [chat({ latestTurn: RUNNING })], delegations: [], blockedItem: false }),
    ).toBe("busy");
    expect(status({ blockedItem: false, delegations: [], chats: [] })).toBe("idle");
  });

  it("ignores chats of other bots", () => {
    const mine = chat({ id: ThreadId.make("mine") });
    const theirs = chat({ id: ThreadId.make("theirs"), botId: OTHER, latestTurn: RUNNING });

    expect(status({ chats: [mine, theirs] })).toBe("idle");
    expect(status({ chats: [theirs] })).toBe("idle");
    expect(status({ chats: [theirs], botId: OTHER })).toBe("busy");
  });

  it("counts a delegated sub-chat toward the bot its root chat belongs to", () => {
    const root = chat({ id: ThreadId.make("root") });

    const sub = chat({
      id: ThreadId.make("sub"),
      botId: OTHER,
      parentThreadId: ThreadId.make("root"),
      hasPendingUserInput: true,
    });

    expect(status({ chats: [root, sub] })).toBe("asking");
    expect(status({ chats: [root, sub], botId: OTHER })).toBe("idle");
  });

  it("stops when a parent chain loops instead of spinning", () => {
    const first = chat({ id: ThreadId.make("a"), parentThreadId: ThreadId.make("b") });
    const second = chat({ id: ThreadId.make("b"), parentThreadId: ThreadId.make("a") });

    expect(status({ chats: [first, second] })).toBe("idle");
  });

  it("counts an archived chat for nothing", () => {
    expect(status({ chats: [chat({ archivedAt: NOW, latestTurn: RUNNING })] })).toBe("idle");
    expect(
      status({
        chats: [chat({ archivedAt: NOW, hasPendingApprovals: true })],
      }),
    ).toBe("idle");
  });

  it("reads the bot responding in a group chat as the one busy there", () => {
    const group = chat({ botId: null, respondingBotId: BOSS, latestTurn: RUNNING });

    expect(status({ chats: [group] })).toBe("busy");
    expect(status({ chats: [group], botId: OTHER })).toBe("idle");
  });

  it("counts each state", () => {
    expect(countBotStatuses(["asking", "busy", "busy", "idle"])).toEqual({
      asking: 1,
      held: 0,
      busy: 2,
      idle: 1,
    });
    expect(countBotStatuses([])).toEqual({ asking: 0, held: 0, busy: 0, idle: 0 });
  });

  it("lists the four states in precedence order", () => {
    expect(BOT_STATUSES).toEqual(["asking", "held", "busy", "idle"]);
  });
});
