import {
  BotId,
  EnvironmentId,
  ThreadId,
  TurnId,
  type OrchestrationSession,
  type OrchestrationSessionStatus,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildBotClearInput,
  buildBotInterruptInput,
  buildBotSteerInput,
  collectClearableSessions,
  collectRunningTurns,
  isBotTurnRunning,
  NO_BOT_CONTROLS,
  resolveBotControlAvailability,
  type BotControllableShell,
  type ScopedBotControllableShell,
} from "./botControls.logic";

const TURN = TurnId.make("turn-1");

const THREAD = ThreadId.make("thread-1");

const BOT = BotId.make("bot-1");

const ENVIRONMENT = EnvironmentId.make("environment-1");

function session(
  status: OrchestrationSessionStatus,
  activeTurnId: TurnId | null = null,
): OrchestrationSession {
  return {
    threadId: THREAD,
    status,
    providerName: "codex",
    runtimeMode: "auto",
    activeTurnId,
    lastError: null,
    updatedAt: "2026-11-13T10:00:00.000Z",
  };
}

function shell(input: {
  readonly status?: OrchestrationSessionStatus;
  readonly activeTurnId?: TurnId | null;
  readonly archived?: boolean;
}): BotControllableShell {
  return {
    id: THREAD,
    botId: BOT,
    session: input.status === undefined ? null : session(input.status, input.activeTurnId ?? null),
    archivedAt: input.archived === true ? "2026-11-13T09:00:00.000Z" : null,
  };
}

function scoped(overrides: Partial<ScopedBotControllableShell>): ScopedBotControllableShell {
  return { ...shell({ status: "idle" }), environmentId: ENVIRONMENT, ...overrides };
}

const RUNNING = shell({ status: "running", activeTurnId: TURN });

describe("isBotTurnRunning", () => {
  it("wants both a running status and a named turn", () => {
    expect(isBotTurnRunning(null)).toBe(false);
    expect(isBotTurnRunning(session("running", TURN))).toBe(true);
    expect(isBotTurnRunning(session("running", null))).toBe(false);
    expect(isBotTurnRunning(session("ready"))).toBe(false);
  });
});

describe("resolveBotControlAvailability", () => {
  it("offers nothing for a missing or archived chat", () => {
    expect(resolveBotControlAvailability(null)).toEqual(NO_BOT_CONTROLS);
    expect(resolveBotControlAvailability(shell({ status: "running", archived: true }))).toEqual(
      NO_BOT_CONTROLS,
    );
  });

  it("offers nothing for a chat that never started a session", () => {
    expect(resolveBotControlAvailability(shell({}))).toEqual(NO_BOT_CONTROLS);
  });

  it("interrupts and steers a running turn, never clears it", () => {
    expect(resolveBotControlAvailability(RUNNING)).toEqual({
      interrupt: true,
      steer: true,
      clear: false,
    });
  });

  it("does not steer a turn that cannot be named", () => {
    expect(resolveBotControlAvailability(shell({ status: "running" }))).toEqual({
      interrupt: false,
      steer: false,
      clear: false,
    });
  });

  it("clears every settled session", () => {
    for (const status of ["idle", "ready", "interrupted", "stopped", "error"] as const) {
      expect(resolveBotControlAvailability(shell({ status }))).toEqual({
        interrupt: false,
        steer: false,
        clear: true,
      });
    }
  });

  it("leaves a starting session alone so the stop cannot race the turn", () => {
    expect(resolveBotControlAvailability(shell({ status: "starting" }))).toEqual(NO_BOT_CONTROLS);
  });
});

describe("buildBotInterruptInput", () => {
  it("pins the turn the user saw", () => {
    expect(buildBotInterruptInput(RUNNING)).toEqual({ threadId: THREAD, turnId: TURN });
  });

  it("is null when no turn is running", () => {
    expect(buildBotInterruptInput(null)).toBeNull();
    expect(buildBotInterruptInput(shell({ status: "ready" }))).toBeNull();
    expect(buildBotInterruptInput(shell({ status: "running" }))).toBeNull();
  });
});

describe("buildBotSteerInput", () => {
  it("names the bot chat to open while its turn runs", () => {
    expect(buildBotSteerInput(RUNNING)).toEqual({ threadId: THREAD, botId: BOT });
  });

  it("is null without a running turn, a bot, or a live chat", () => {
    expect(buildBotSteerInput(null)).toBeNull();
    expect(buildBotSteerInput(shell({ status: "idle" }))).toBeNull();
    expect(buildBotSteerInput(shell({ status: "running" }))).toBeNull();
    expect(buildBotSteerInput(shell({ status: "running", archived: true }))).toBeNull();

    // A group chat has no composer of its own to steer into.
    expect(buildBotSteerInput({ ...RUNNING, botId: null })).toBeNull();
  });
});

describe("buildBotClearInput", () => {
  it("targets a settled session", () => {
    expect(buildBotClearInput(shell({ status: "idle" }))).toEqual({ threadId: THREAD });
  });

  it("is null without a session, mid-turn, or mid-start", () => {
    expect(buildBotClearInput(null)).toBeNull();
    expect(buildBotClearInput(shell({}))).toBeNull();
    expect(buildBotClearInput(RUNNING)).toBeNull();
    expect(buildBotClearInput(shell({ status: "starting" }))).toBeNull();
  });
});

describe("collectRunningTurns", () => {
  it("carries the environment and the turn for each live turn", () => {
    expect(collectRunningTurns([scoped({ session: session("running", TURN) })])).toEqual([
      { environmentId: ENVIRONMENT, threadId: THREAD, botId: BOT, turnId: TURN },
    ]);
  });

  it("skips archived, unsettled and turn-less chats", () => {
    expect(
      collectRunningTurns([
        scoped({ session: session("running", TURN), archivedAt: "2026-11-13T09:00:00.000Z" }),
        scoped({ session: session("ready") }),
        scoped({ session: null }),
        scoped({ session: session("running", null) }),
      ]),
    ).toEqual([]);
  });

  it("spans environments", () => {
    const other = EnvironmentId.make("environment-2");

    expect(
      collectRunningTurns([
        scoped({ session: session("running", TURN) }),
        scoped({ session: session("running", TurnId.make("turn-2")), environmentId: other }),
      ]).map((target) => target.environmentId),
    ).toEqual([ENVIRONMENT, other]);
  });
});

describe("collectClearableSessions", () => {
  it("collects settled sessions with no turn to pin", () => {
    expect(collectClearableSessions([scoped({ session: session("ready") })])).toEqual([
      { environmentId: ENVIRONMENT, threadId: THREAD, botId: BOT, turnId: null },
    ]);
  });

  it("never clears a chat that is working or starting", () => {
    expect(
      collectClearableSessions([
        scoped({ session: session("running", TURN) }),
        scoped({ session: session("starting") }),
        scoped({ session: session("ready"), archivedAt: "2026-11-13T09:00:00.000Z" }),
      ]),
    ).toEqual([]);
  });
});
