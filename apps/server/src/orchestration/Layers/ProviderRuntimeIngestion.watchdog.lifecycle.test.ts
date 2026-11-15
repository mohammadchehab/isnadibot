import {
  ProviderDriverKind,
  ProviderRuntimeEvent,
  RuntimeRequestId,
  THREAD_SILENT_RUN_ACTIVITY_KIND,
} from "@isnadi/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TURN_WENT_SILENT_ERROR } from "./runtime-ingestion/Watchdogs.ts";
import {
  asTurnId,
  asEventId,
  asThreadId,
  SILENT_MS,
  makeSilenceWatchdogHarness,
} from "./test-support/SilenceWatchdogHarness.ts";

/**
 * How long a silent mark stands before the turn is settled, pinned here on purpose: the window is
 * part of the contract this file proves, so moving it has to be a visible change to the test.
 */
const LIVENESS_WINDOW_MS = 30 * 60 * 1_000;

describe("ProviderRuntimeIngestion silence watchdog", () => {
  const testScope = makeSilenceWatchdogHarness();
  const { createHarness, silentKinds, silenceIncidents } = testScope;
  afterEach(testScope.dispose);
  it("pauses on approval wait and resumes on request.resolved", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-approval-pause");
    const requestId = RuntimeRequestId.make("req-approval-pause");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    harness.emit({
      type: "request.opened",
      eventId: asEventId("evt-approval-opened"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      turnId,
      requestId,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { requestType: "command_execution_approval", detail: "pwd" },
    });
    await harness.drain();

    await harness.adjustClock(SILENT_MS * 3);
    await harness.drain();
    expect(await harness.watchdogActivities()).toHaveLength(0);

    harness.emit({
      type: "request.resolved",
      eventId: asEventId("evt-approval-resolved"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      turnId,
      requestId,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { requestType: "command_execution_approval", decision: "accept" },
    });
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();
    expect(silentKinds(await harness.watchdogActivities())).toEqual([
      THREAD_SILENT_RUN_ACTIVITY_KIND,
    ]);
    expect(harness.interruptCalls).toEqual([]);
  });

  it("pauses on user-input wait and resumes on user-input.resolved", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-userinput-pause");
    const requestId = RuntimeRequestId.make("req-userinput-pause");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    harness.emit({
      type: "user-input.requested",
      eventId: asEventId("evt-userinput-opened"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      turnId,
      requestId,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: {
        questions: [
          {
            id: "q1",
            header: "Q",
            question: "Pick one",
            options: [{ label: "a", description: "A" }],
          },
        ],
      },
    });
    await harness.drain();

    await harness.adjustClock(SILENT_MS * 3);
    await harness.drain();
    expect(await harness.watchdogActivities()).toHaveLength(0);

    harness.emit({
      type: "user-input.resolved",
      eventId: asEventId("evt-userinput-resolved"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      turnId,
      requestId,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { answers: { q1: "a" } },
    });
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();
    expect(silentKinds(await harness.watchdogActivities())).toEqual([
      THREAD_SILENT_RUN_ACTIVITY_KIND,
    ]);
  });

  it("settles a turn whose silence outlives the liveness window, with a typed reason", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-silent-expired");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();
    expect(silenceIncidents(harness)).toMatchObject([{ status: "open" }]);

    // The mark is provisional, so it does not end the turn on its own. The window runs from the
    // last provider event, so the silent mark has already spent part of it.
    await harness.adjustClock(LIVENESS_WINDOW_MS - SILENT_MS - 1);
    await harness.drain();

    const waiting = (await harness.readModel()).threads.find(
      (t) => t.id === asThreadId("thread-1"),
    );

    expect(waiting?.latestTurn?.state).toBe("running");

    await harness.adjustClock(1);
    await harness.drain();

    const settled = (await harness.readModel()).threads.find(
      (t) => t.id === asThreadId("thread-1"),
    );

    expect(settled?.latestTurn?.state).toBe("error");
    expect(settled?.session?.status).toBe("error");
    expect(settled?.session?.lastError).toBe(TURN_WENT_SILENT_ERROR);
    // The code, not only the prose: it is what surfaces render the sentence from, and what tells
    // this apart from the session-gone reason.
    expect(settled?.session?.lastErrorCode).toBe("turn-went-silent");
    expect(settled?.session?.activeTurnId).toBeNull();
    // The incident is closed by the turn ending, so it is not left claiming the chat is running.
    expect(silenceIncidents(harness)).toMatchObject([{ status: "resolved" }]);
  });

  /**
   * Claude declares ten minutes of legitimate silence, doubled to twenty. Pinned here as a literal
   * for the same reason as the window above: a global constant would pass this test at 30 minutes
   * and fail at 20, so the number has to be visible in the test that proves it.
   */
  const CLAUDE_LIVENESS_WINDOW_MS = 20 * 60 * 1_000;

  it("settles on the provider's own window, not on one server-wide number", async () => {
    const harness = await createHarness({
      botOwned: true,
      provider: ProviderDriverKind.make("claudeAgent"),
    });

    const turnId = asTurnId("turn-silent-claude-expired");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();

    // The conservative default would still be counting down here.
    await harness.adjustClock(CLAUDE_LIVENESS_WINDOW_MS - SILENT_MS - 1);
    await harness.drain();

    const waiting = (await harness.readModel()).threads.find(
      (t) => t.id === asThreadId("thread-1"),
    );

    expect(waiting?.latestTurn?.state).toBe("running");

    await harness.adjustClock(1);
    await harness.drain();

    const settled = (await harness.readModel()).threads.find(
      (t) => t.id === asThreadId("thread-1"),
    );

    expect(settled?.latestTurn?.state).toBe("error");
    expect(settled?.session?.lastErrorCode).toBe("turn-went-silent");
  });

  it("keeps the turn open when the provider speaks inside the liveness window", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-silent-recovered");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();
    await harness.adjustClock(LIVENESS_WINDOW_MS - SILENT_MS - 1_000);
    harness.emitReasoning(turnId, "back-after-a-long-tool-run");
    await harness.drain();
    // That event restarted the window: a full window less a millisecond from it is still open,
    // where the window that started with the turn would have expired long ago.
    await harness.adjustClock(LIVENESS_WINDOW_MS - 1);
    await harness.drain();

    const thread = (await harness.readModel()).threads.find((t) => t.id === asThreadId("thread-1"));
    expect(thread?.latestTurn?.state).toBe("running");
    expect(thread?.session?.status).toBe("running");
    expect(thread?.session?.activeTurnId).toBe(turnId);
  });

  it.each(["completed", "interrupted", "aborted"] as const)(
    "disposes the watchdog and resolves the inbox item when a silent turn is %s",
    async (ending) => {
      const harness = await createHarness({ botOwned: true });
      const turnId = `turn-ended-${ending}`;
      harness.emitTurnStarted(turnId);
      await harness.drain();
      await harness.adjustClock(SILENT_MS);
      await harness.drain();
      expect(silenceIncidents(harness)).toMatchObject([{ status: "open" }]);

      harness.emitTurnEnded(turnId, ending);
      await harness.drain();
      expect(silenceIncidents(harness)).toMatchObject([{ status: "resolved" }]);

      // A late event for the ended turn cannot revive the disposed watchdog.
      harness.emitReasoning(turnId, "late");
      await harness.drain();
      await harness.adjustClock(SILENT_MS * 3);
      await harness.drain();
      expect(silentKinds(await harness.watchdogActivities())).toEqual([
        THREAD_SILENT_RUN_ACTIVITY_KIND,
      ]);
      expect(silenceIncidents(harness)).toMatchObject([{ status: "resolved" }]);
    },
  );

  it("keeps waiting while another request is open after a duplicate resolution", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-duplicate-resolution");
    harness.emitTurnStarted(turnId);
    await harness.drain();

    const request = (type: "request.opened" | "request.resolved", id: string, n: number) =>
      harness.emit({
        type,
        eventId: asEventId(`evt-${type}-${id}-${n}`),
        provider: harness.provider,
        threadId: asThreadId("thread-1"),
        turnId,
        requestId: RuntimeRequestId.make(id),
        createdAt: "2026-01-01T00:00:00.000Z",
        payload:
          type === "request.opened"
            ? { requestType: "command_execution_approval", detail: "pwd" }
            : { requestType: "command_execution_approval", decision: "accept" },
      } as ProviderRuntimeEvent);

    request("request.opened", "req-a", 0);
    request("request.opened", "req-b", 0);
    request("request.resolved", "req-a", 0);
    request("request.resolved", "req-a", 1);
    await harness.drain();

    await harness.adjustClock(SILENT_MS * 3);
    await harness.drain();
    expect(await harness.watchdogActivities()).toHaveLength(0);
  });

  it("does not let a stale turn start replace the active turn's watchdog", async () => {
    const harness = await createHarness({ botOwned: true });
    harness.emitTurnStarted("turn-active");
    await harness.drain();
    harness.emitTurnStarted("turn-stale");
    await harness.drain();

    await harness.adjustClock(SILENT_MS);
    await harness.drain();
    const ids = (await harness.watchdogActivities()).map((activity) => activity.id);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("turn-active");
  });

  it("stops the watchdog when the session stops without a turn ending", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-session-stopped");
    harness.emitTurnStarted(turnId);
    await harness.drain();
    harness.emit({
      type: "session.state.changed",
      eventId: asEventId("evt-session-stopped"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: { state: "stopped" },
    });
    await harness.drain();
    await harness.adjustClock(SILENT_MS * 3);
    await harness.drain();
    expect(await harness.watchdogActivities()).toHaveLength(0);
  });

  it("stops the watchdog on session.exited", async () => {
    const harness = await createHarness({ botOwned: true });
    const turnId = asTurnId("turn-exited-stop");
    harness.emitTurnStarted(turnId);
    await harness.drain();
    harness.emit({
      type: "session.exited",
      eventId: asEventId("evt-exited-stop"),
      provider: harness.provider,
      threadId: asThreadId("thread-1"),
      turnId,
      createdAt: "2026-01-01T00:00:00.000Z",
      payload: {},
    });
    await harness.drain();
    await harness.adjustClock(SILENT_MS * 3);
    await harness.drain();
    expect(await harness.watchdogActivities()).toHaveLength(0);
    expect(silenceIncidents(harness)).toHaveLength(0);
  });
});
