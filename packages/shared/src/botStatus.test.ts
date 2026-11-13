import { describe, expect, it } from "vite-plus/test";

import {
  BotId,
  ThreadId,
  TurnId,
  type IsnadiDelegationPhase,
  type OrchestrationLatestTurn,
  type OrchestrationSession,
  type OrchestrationSessionStatus,
} from "@isnadi/contracts";

import {
  BOT_STATUSES,
  countBotStatuses,
  deriveBotStatus,
  idleSince,
  type BotStatus,
  type BotStatusChat,
  type BotStatusWorkItem,
} from "./botStatus.ts";

const BOSS = BotId.make("boss");

const OTHER = BotId.make("other");

const NOW = "2026-11-13T10:00:00.000Z";

/** The session a chat holds, as the wire shape refuses to leave a field out. */
type ChatSession = NonNullable<BotStatusChat["session"]>;

function chatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    threadId: ThreadId.make("chat-1"),
    status: "ready",
    providerName: null,
    runtimeMode: "auto",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
    ...overrides,
  };
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

function session(status: OrchestrationSessionStatus): OrchestrationSession {
  return {
    threadId: ThreadId.make("chat-1"),
    status,
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: null,
    lastError: null,
    updatedAt: NOW,
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

/** A turn that died because the provider's login is gone, which only the user can fix. */
const EXPIRED_TURN: OrchestrationLatestTurn = { ...ERRORED, unavailability: "expired-login" };

/** A session that never got a turn off the ground because its login is gone. */
const SESSION_SIGNED_OUT: ChatSession = chatSession({
  status: "error",
  lastError: "login expired",
  unavailability: "expired-login",
});

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
  result: { summary: "done", childThreadId: ThreadId.make("child-1"), childTurnId: null },
  acknowledgedAt: null,
};

/** One flag per state a chat can signal, so a case can name the pair it puts in conflict. */
interface Signals {
  readonly asking?: boolean;
  readonly signIn?: boolean;
  readonly held?: boolean;
  readonly busy?: boolean;
}

/**
 * The chats that carry each signal. Asking and sign-in each need a chat of
 * their own, because a single chat cannot both wait on the user and fail to
 * reach its provider.
 */
function chatsFor(signals: Signals): ReadonlyArray<BotStatusChat> {
  const chats: BotStatusChat[] = [];

  if (signals.asking === true) {
    chats.push(
      chat({ id: ThreadId.make("asking"), latestTurn: COMPLETED, hasPendingUserInput: true }),
    );
  }

  if (signals.signIn === true) {
    chats.push(chat({ id: ThreadId.make("signin"), latestTurn: EXPIRED_TURN }));
  }

  if (signals.busy === true) {
    chats.push(chat({ id: ThreadId.make("busy"), latestTurn: RUNNING }));
  }

  return chats;
}

function status(input: {
  chats?: ReadonlyArray<BotStatusChat>;
  blockedItem?: boolean;
  items?: ReadonlyArray<BotStatusWorkItem>;
  delegations?: ReadonlyArray<{ parentThreadId: ThreadId; phase: IsnadiDelegationPhase }>;
  botId?: BotId;
}): BotStatus {
  const ownerBotId = input.botId ?? BOSS;

  return deriveBotStatus({
    botId: ownerBotId,
    chats: input.chats ?? [],
    workItems:
      input.items ?? (input.blockedItem === true ? [{ ownerBotId, state: "blocked" }] : []),
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

  it("is busy while it owns an item in assigned or in-progress", () => {
    for (const state of ["assigned", "in-progress"] as const) {
      expect(status({ items: [{ ownerBotId: BOSS, state }] })).toBe("busy");
    }

    // A queued item has no owner yet, and a closed one is finished work.
    expect(status({ items: [{ ownerBotId: BOSS, state: "queued" }] })).toBe("idle");
    expect(status({ items: [{ ownerBotId: BOSS, state: "closed" }] })).toBe("idle");
    expect(status({ items: [{ ownerBotId: OTHER, state: "in-progress" }] })).toBe("idle");
  });

  it("is busy while a session is starting or running, before any turn reports", () => {
    for (const running of ["starting", "running"] as const) {
      expect(status({ chats: [chat({ session: session(running) })] })).toBe("busy");
    }

    for (const stopped of ["idle", "ready", "interrupted", "stopped", "error"] as const) {
      expect(status({ chats: [chat({ session: session(stopped) })] })).toBe("idle");
    }
  });

  it("counts a session on an archived chat for nothing", () => {
    expect(status({ chats: [chat({ archivedAt: NOW, session: session("running") })] })).toBe(
      "idle",
    );
  });

  it("counts each state", () => {
    expect(countBotStatuses(["asking", "busy", "busy", "idle"])).toEqual({
      asking: 1,
      "sign-in-required": 0,
      held: 0,
      busy: 2,
      idle: 1,
    });
    expect(countBotStatuses([])).toEqual({
      asking: 0,
      "sign-in-required": 0,
      held: 0,
      busy: 0,
      idle: 0,
    });
  });

  it("lists the five states in precedence order", () => {
    expect(BOT_STATUSES).toEqual(["asking", "sign-in-required", "held", "busy", "idle"]);
  });

  it("counts a sign-in requirement", () => {
    expect(countBotStatuses(["asking", "sign-in-required", "busy", "busy", "idle"])).toEqual({
      asking: 1,
      "sign-in-required": 1,
      held: 0,
      busy: 2,
      idle: 1,
    });
  });
});

describe("deriveBotStatus sign-in-required", () => {
  it("reads the need to sign in from the turn that died, or from the session when none started", () => {
    expect(status({ chats: [chat({ latestTurn: EXPIRED_TURN })] })).toBe("sign-in-required");
    expect(status({ chats: [chat({ session: SESSION_SIGNED_OUT })] })).toBe("sign-in-required");
  });

  it("trusts the turn's own reason over the session's", () => {
    expect(
      status({
        chats: [
          chat({
            latestTurn: EXPIRED_TURN,
            session: chatSession({ status: "error", unavailability: "usage-cap" }),
          }),
        ],
      }),
    ).toBe("sign-in-required");
  });

  it("is not a sign-in state for an error signing in cannot fix", () => {
    for (const latestTurn of [COMPLETED, INTERRUPTED, ERRORED]) {
      expect(status({ chats: [chat({ latestTurn })] })).toBe("idle");
    }

    expect(
      status({ chats: [chat({ latestTurn: { ...ERRORED, unavailability: "usage-cap" } })] }),
    ).toBe("idle");
    expect(status({ chats: [chat({ session: chatSession() })] })).toBe("idle");
    expect(
      status({
        chats: [
          chat({ session: chatSession({ status: "error", unavailability: "temporary-failure" }) }),
        ],
      }),
    ).toBe("idle");
  });

  it("counts an archived chat's sign-in requirement for nothing", () => {
    expect(status({ chats: [chat({ archivedAt: NOW, latestTurn: EXPIRED_TURN })] })).toBe("idle");
  });

  it("counts another bot's sign-in requirement for nothing", () => {
    const theirs = chat({
      id: ThreadId.make("theirs"),
      botId: OTHER,
      latestTurn: EXPIRED_TURN,
    });

    expect(status({ chats: [theirs] })).toBe("idle");
    expect(status({ chats: [theirs], botId: OTHER })).toBe("sign-in-required");
  });

  it("counts a delegated sub-chat's sign-in requirement toward its root chat's bot", () => {
    const root = chat({ id: ThreadId.make("root") });

    const sub = chat({
      id: ThreadId.make("sub"),
      botId: OTHER,
      parentThreadId: ThreadId.make("root"),
      latestTurn: EXPIRED_TURN,
    });

    expect(status({ chats: [root, sub] })).toBe("sign-in-required");
    expect(status({ chats: [root, sub], botId: OTHER })).toBe("idle");
  });

  it("picks the higher state for every pair of signals, and for all of them at once", () => {
    const cases: ReadonlyArray<{
      readonly signals: Signals;
      readonly expected: BotStatus;
    }> = [
      { signals: {}, expected: "idle" },
      { signals: { asking: true }, expected: "asking" },
      { signals: { signIn: true }, expected: "sign-in-required" },
      { signals: { held: true }, expected: "held" },
      { signals: { busy: true }, expected: "busy" },
      { signals: { asking: true, signIn: true }, expected: "asking" },
      { signals: { asking: true, held: true }, expected: "asking" },
      { signals: { asking: true, busy: true }, expected: "asking" },
      { signals: { signIn: true, held: true }, expected: "sign-in-required" },
      { signals: { signIn: true, busy: true }, expected: "busy" },
      { signals: { held: true, busy: true }, expected: "held" },
      { signals: { asking: true, signIn: true, held: true, busy: true }, expected: "asking" },
      { signals: { signIn: true, held: true, busy: true }, expected: "held" },
    ];

    for (const { signals, expected } of cases) {
      expect(
        status({ chats: chatsFor(signals), blockedItem: signals.held === true }),
        JSON.stringify(signals),
      ).toBe(expected);
    }
  });
});

describe("idleSince", () => {
  function idleOf(chats: ReadonlyArray<BotStatusChat>, botId: BotId = BOSS): string | null {
    return idleSince({ botId, chats, workItems: [], delegations: [] });
  }

  it("is null for a bot that never had a turn, which reads as idle longest", () => {
    expect(idleOf([])).toBeNull();
    expect(idleOf([chat()])).toBeNull();
  });

  it("is when the last turn finished, whatever its outcome", () => {
    for (const turn of [COMPLETED, INTERRUPTED, ERRORED]) {
      expect(idleOf([chat({ latestTurn: turn })])).toBe(turn.completedAt);
    }
  });

  it("is when the last turn started while it has not finished, or when it was asked", () => {
    expect(idleOf([chat({ latestTurn: RUNNING })])).toBe(NOW);
    expect(
      idleOf([
        chat({ latestTurn: { ...RUNNING, startedAt: null, requestedAt: "2026-11-13T09:00:00Z" } }),
      ]),
    ).toBe("2026-11-13T09:00:00Z");
  });

  it("is the most recent turn across every chat the bot speaks for", () => {
    const earlier = chat({
      id: ThreadId.make("chat-old"),
      latestTurn: { ...COMPLETED, completedAt: "2026-11-13T08:00:00Z" },
    });

    const later = chat({
      id: ThreadId.make("chat-new"),
      latestTurn: { ...COMPLETED, completedAt: "2026-11-13T09:30:00Z" },
    });

    expect(idleOf([earlier, later])).toBe("2026-11-13T09:30:00Z");
    expect(idleOf([later, earlier])).toBe("2026-11-13T09:30:00Z");
  });

  it("ignores another bot's chat and an archived one", () => {
    const busyOther = chat({
      id: ThreadId.make("other-chat"),
      botId: OTHER,
      latestTurn: { ...COMPLETED, completedAt: "2026-11-13T09:30:00Z" },
    });

    const archived = chat({
      id: ThreadId.make("archived-chat"),
      archivedAt: NOW,
      latestTurn: { ...COMPLETED, completedAt: "2026-11-13T09:30:00Z" },
    });

    expect(idleOf([busyOther, archived])).toBeNull();
  });

  it("counts a group chat for the bot responding in it", () => {
    const groupChat = chat({
      id: ThreadId.make("group-chat"),
      botId: null,
      respondingBotId: BOSS,
      latestTurn: COMPLETED,
    });

    expect(idleOf([groupChat])).toBe(NOW);
    expect(idleOf([groupChat], OTHER)).toBeNull();
  });

  it("counts a delegated sub-chat toward the bot its root chat belongs to", () => {
    const root = chat({ id: ThreadId.make("root"), latestTurn: COMPLETED });

    const child = chat({
      id: ThreadId.make("child"),
      botId: null,
      parentThreadId: ThreadId.make("root"),
      latestTurn: { ...COMPLETED, completedAt: "2026-11-13T11:00:00Z" },
    });

    expect(idleOf([root, child])).toBe("2026-11-13T11:00:00Z");
  });
});
