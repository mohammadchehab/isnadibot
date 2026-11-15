import {
  EventId,
  type OrchestrationLatestTurn,
  type OrchestrationThreadActivity,
  TurnId,
} from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  activeThreadRuntimeWarning,
  commandFailure,
  latestBotThreadFailure,
  latestThreadRuntimeError,
} from "./threadRuntimeWarning.logic";

const turnId = TurnId.make("turn-warning");

const timestamp = "2026-09-11T12:00:00.000Z";

const runningTurn: OrchestrationLatestTurn = {
  turnId,
  state: "running",
  requestedAt: timestamp,
  startedAt: timestamp,
  completedAt: null,
  assistantMessageId: null,
};

const warningPayload = { message: "Claude is paused until the usage window resets." };

const warning: OrchestrationThreadActivity = {
  id: EventId.make("warning-current"),
  tone: "info",
  kind: "runtime.warning",
  summary: "Usage limit reached",
  payload: warningPayload,
  turnId,
  createdAt: timestamp,
};

describe("activeThreadRuntimeWarning", () => {
  it("shows the latest warning for the running turn", () => {
    expect(activeThreadRuntimeWarning([warning], runningTurn)).toBe(
      "Claude is paused until the usage window resets.",
    );
  });

  it.each(["completed", "error"] as const)(
    "removes the active warning when the turn becomes %s",
    (state) => {
      expect(
        activeThreadRuntimeWarning([warning], {
          ...runningTurn,
          state,
          completedAt: timestamp,
        }),
      ).toBeNull();
    },
  );

  it("does not revive a warning from an earlier turn", () => {
    expect(
      activeThreadRuntimeWarning([warning], {
        ...runningTurn,
        turnId: TurnId.make("turn-recovered"),
      }),
    ).toBeNull();
  });

  it("clears a recovered warning while the turn remains running", () => {
    expect(
      activeThreadRuntimeWarning(
        [
          { ...warning, payload: { ...warningPayload, key: "claude.rate-limit:five_hour" } },
          {
            ...warning,
            id: EventId.make("warning-recovered"),
            summary: "Claude usage limit recovered. Processing resumed.",
            payload: {
              message: "Claude usage limit recovered. Processing resumed.",
              key: "claude.rate-limit:five_hour",
              resolved: true,
            },
          },
        ],
        runningTurn,
      ),
    ).toBeNull();
  });

  it("keeps another keyed warning visible after one warning recovers", () => {
    expect(
      activeThreadRuntimeWarning(
        [
          { ...warning, payload: { ...warningPayload, key: "claude.rate-limit:seven_day" } },
          {
            ...warning,
            id: EventId.make("warning-five-hour"),
            payload: { ...warningPayload, key: "claude.rate-limit:five_hour" },
          },
          {
            ...warning,
            id: EventId.make("warning-five-hour-recovered"),
            summary: "Claude usage limit recovered. Processing resumed.",
            payload: {
              message: "Claude usage limit recovered. Processing resumed.",
              key: "claude.rate-limit:five_hour",
              resolved: true,
            },
          },
        ],
        runningTurn,
      ),
    ).toBe("Claude is paused until the usage window resets.");
  });
});

describe("latestThreadRuntimeError", () => {
  it("keeps a failed turn's provider error visible after the session recovers", () => {
    const failedTurn = { ...runningTurn, state: "error" as const, completedAt: timestamp };

    const activity = {
      ...warning,
      kind: "runtime.error",
      tone: "error" as const,
      payload: { message: "The usage limit has been reached" },
    };

    expect(latestThreadRuntimeError([activity], failedTurn)).toBe(
      "The usage limit has been reached",
    );
  });

  it("does not surface an old error for a running turn", () => {
    expect(latestThreadRuntimeError([warning], runningTurn)).toBeNull();
  });
});

describe("latestBotThreadFailure", () => {
  const laterTimestamp = "2026-09-11T12:05:00.000Z";

  const startFailed: OrchestrationThreadActivity = {
    ...warning,
    id: EventId.make("activity-start-failed"),
    kind: "provider.turn.start.failed",
    tone: "error",
    turnId: null,
    summary: "Provider turn start failed",
    payload: { detail: "Claude is not signed in.", unavailability: "missing-login" },
    createdAt: laterTimestamp,
  };

  it("explains a request the provider never started", () => {
    expect(
      latestBotThreadFailure({
        activities: [startFailed],
        latestTurn: null,
        session: { status: "error", lastError: "Claude is not signed in." },
        lastUserMessageAt: laterTimestamp,
      }),
    ).toEqual({ message: "Claude is not signed in.", unavailability: "missing-login" });
  });

  it("explains a newer request after an earlier turn completed", () => {
    const completedTurn = { ...runningTurn, state: "completed" as const, completedAt: timestamp };
    expect(
      latestBotThreadFailure({
        activities: [startFailed],
        latestTurn: completedTurn,
        session: { status: "error", lastError: "Claude is not signed in." },
        lastUserMessageAt: laterTimestamp,
      }),
    ).toEqual({ message: "Claude is not signed in.", unavailability: "missing-login" });
  });

  it("renders a turn the server closed for a typed reason from the shared map", () => {
    const silentTurn = {
      ...runningTurn,
      state: "error" as const,
      completedAt: timestamp,
    };

    expect(
      latestBotThreadFailure({
        activities: [],
        latestTurn: silentTurn,
        session: {
          status: "error",
          // The server's own prose, deliberately different: the code decides the sentence, so a
          // server that words it differently cannot change what the user reads.
          lastError: "provider went quiet",
          lastErrorCode: "turn-went-silent",
        },
        lastUserMessageAt: timestamp,
      }),
    ).toEqual({
      message: "This turn stopped responding, so it was closed. Try again.",
      unavailability: null,
    });
  });

  it("falls back to the session's own prose for a reason this build does not know", () => {
    const silentTurn = {
      ...runningTurn,
      state: "error" as const,
      completedAt: timestamp,
    };

    expect(
      latestBotThreadFailure({
        activities: [],
        latestTurn: silentTurn,
        session: {
          status: "error",
          lastError: "A reason from a newer server.",
          lastErrorCode: "some-future-reason",
        },
        lastUserMessageAt: timestamp,
      }),
    ).toEqual({ message: "A reason from a newer server.", unavailability: null });
  });

  it("keeps a failed turn's category", () => {
    const failedTurn = {
      ...runningTurn,
      state: "error" as const,
      completedAt: timestamp,
      unavailability: "limit-reached" as const,
    };

    expect(
      latestBotThreadFailure({
        activities: [
          {
            ...warning,
            kind: "runtime.error",
            tone: "error",
            payload: { message: "The usage limit has been reached" },
          },
        ],
        latestTurn: failedTurn,
        session: null,
        lastUserMessageAt: timestamp,
      }),
    ).toEqual({
      message: "The usage limit has been reached",
      unavailability: "limit-reached",
    });
  });

  it("keeps the message when a newer server names an unavailability this build does not know", () => {
    const failedTurn = {
      ...runningTurn,
      state: "error" as const,
      completedAt: timestamp,
      unavailability: "quota-exhausted",
    };

    expect(
      latestBotThreadFailure({
        activities: [
          {
            ...warning,
            kind: "runtime.error",
            tone: "error",
            payload: { message: "Codex is out of credits." },
          },
        ],
        latestTurn: failedTurn,
        session: null,
        lastUserMessageAt: timestamp,
      }),
    ).toEqual({ message: "Codex is out of credits.", unavailability: null });
  });

  it("uses a newer start failure instead of an earlier failed turn", () => {
    const failedTurn = {
      ...runningTurn,
      state: "error" as const,
      completedAt: timestamp,
      unavailability: "limit-reached" as const,
    };

    expect(
      latestBotThreadFailure({
        activities: [startFailed],
        latestTurn: failedTurn,
        session: { status: "error", lastError: "Claude is not signed in." },
        lastUserMessageAt: laterTimestamp,
      }),
    ).toEqual({ message: "Claude is not signed in.", unavailability: "missing-login" });
  });

  it("stays quiet once the request has a reply", () => {
    const completedTurn = { ...runningTurn, state: "completed" as const, completedAt: timestamp };
    expect(
      latestBotThreadFailure({
        activities: [startFailed],
        latestTurn: completedTurn,
        session: { status: "ready", lastError: null },
        lastUserMessageAt: timestamp,
      }),
    ).toBeNull();
  });
});

describe("commandFailure", () => {
  /**
   * A refused command as it crosses the wire: the server's sentence names the
   * chat, and the code is what a client switches on. Every chat-send path hands
   * this straight to the user, which is why the helper — not each call site —
   * has to prefer the catalog copy.
   */
  const refusalFailure = (refusal: string) => ({
    cause: Cause.fail({
      message:
        "Orchestration command invariant failed (thread.turn.start): Bot mentions can only route turns on a group-owned thread.",
      refusal,
    }),
  });

  /** The English catalog, as the web `t` looks it up: key in, sentence out. */
  const translate = (message: string) => message;

  it("shows the catalog sentence for a coded refusal, not the server's invariant prose", () => {
    const failure = commandFailure(refusalFailure("thread-does-not-take-mentions"), translate);

    expect(failure.message).toBe(
      "Bot mentions only work in a space chat. Remove the mention and send again.",
    );
    expect(failure.message).not.toContain("group-owned thread");
  });

  it("keeps the server sentence for a code this client does not know", () => {
    const failure = commandFailure(refusalFailure("a-code-from-a-newer-server"), translate);

    expect(failure.message).toContain("group-owned thread");
  });

  it("still shows catalog copy when a caller passes no translator", () => {
    const failure = commandFailure(refusalFailure("stale-view"));

    expect(failure.message).toBe("Something here has changed. Refresh to see the latest.");
  });
});
