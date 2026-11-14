import * as Schema from "effect/Schema";
import * as Predicate from "effect/Predicate";
import { ProviderDriverKind, ProviderInstanceId } from "@isnadi/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  asEventId,
  asThreadId,
  asTurnId,
  waitForThread,
  type ProviderRuntimeTestActivity,
  asItemId,
  createRuntimeIngestionHarness,
} from "./test-support/RuntimeIngestionHarness.ts";

describe("ProviderRuntimeIngestion", () => {
  const testScope = createRuntimeIngestionHarness();
  const { createHarness } = testScope;
  afterEach(testScope.dispose);
  it("maps runtime.error into errored session state", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-3"),
      payload: {
        message: "runtime exploded",
      },
    });

    const thread = await waitForThread(
      harness,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-3" &&
        entry.session?.lastError === "runtime exploded",
    );

    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime exploded");
  });

  it("carries a revoked sign-in's category to the session event and the activity", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-revoked"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-revoked"),
      payload: {
        message: "OAuth access token has been revoked.",
        class: "provider_error",
      },
    });

    const thread = await waitForThread(harness, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-runtime-error-revoked"),
    );

    expect(thread.session?.status).toBe("error");
    expect(thread.session?.providerInstanceId).toBe("claude");
    // Read back from the projection store, which is what a reload renders: the category has to
    // survive the round trip, not just ride along on the event.
    expect(thread.session?.unavailability).toBe("expired-login");

    const activity = thread.activities.find(
      (entry: ProviderRuntimeTestActivity) => entry.id === "evt-runtime-error-revoked",
    );

    const activityPayload =
      activity?.payload &&
      (activity.payload === null || Predicate.isObjectOrArray(activity.payload))
        ? (activity.payload as Record<string, Schema.Json>)
        : undefined;

    expect(activityPayload?.unavailability).toBe("expired-login");
    expect(activityPayload?.providerInstanceId).toBe("claude");
    expect(activityPayload?.class).toBe("provider_error");

    expect(thread.session?.lastError).toBe("OAuth access token has been revoked.");

    harness.emit({
      type: "thread.started",
      eventId: asEventId("evt-thread-started-recovered"),
      provider: ProviderDriverKind.make("claudeAgent"),
      providerInstanceId: ProviderInstanceId.make("claude"),
      createdAt: "2026-01-01T00:00:01.000Z",
      threadId: asThreadId("thread-1"),
    });

    const recovered = await waitForThread(
      harness,
      (entry) => entry.session?.unavailability === undefined,
    );

    // A session update that carries no category clears the stored one, so a sign-in that works
    // again stops reading as a problem.
    expect(recovered.session?.status).toBe("running");
    expect(recovered.session?.unavailability).toBeUndefined();
  });

  it("records runtime.error activities from the typed payload message", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-activity"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-runtime-error-activity"),
      payload: {
        message: "runtime activity exploded",
      },
    });

    const thread = await waitForThread(harness, (entry) =>
      entry.activities.some((activity) => activity.id === "evt-runtime-error-activity"),
    );

    const activity = thread.activities.find(
      (entry: ProviderRuntimeTestActivity) => entry.id === "evt-runtime-error-activity",
    );

    const activityPayload =
      activity?.payload &&
      (activity.payload === null || Predicate.isObjectOrArray(activity.payload))
        ? (activity.payload as Record<string, Schema.Json>)
        : undefined;

    expect(activity?.kind).toBe("runtime.error");
    expect(activityPayload?.message).toBe("runtime activity exploded");
  });

  it("keeps the session running when a runtime.warning arrives during an active turn", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "turn.started",
      eventId: asEventId("evt-warning-turn-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-warning"),
      payload: {},
    });

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-warning-runtime"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-warning"),
      payload: {
        message: "Reconnecting... 2/5",
        key: "provider.retry",
        detail: {
          willRetry: true,
        },
      },
    });

    harness.emit({
      type: "runtime.warning",
      eventId: asEventId("evt-warning-resolved"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-warning"),
      payload: {
        message: "Reconnected.",
        key: "provider.retry",
        resolved: true,
      },
    });

    const thread = await waitForThread(
      harness,
      (entry) =>
        entry.session?.status === "running" &&
        entry.session?.activeTurnId === "turn-warning" &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) =>
            activity.id === "evt-warning-runtime" && activity.kind === "runtime.warning",
        ) &&
        entry.activities.some((activity) => activity.id === "evt-warning-resolved"),
    );

    expect(thread.session?.status).toBe("running");
    expect(thread.session?.activeTurnId).toBe("turn-warning");
    expect(thread.session?.lastError).toBeNull();

    const resolvedActivity = thread.activities.find(
      (activity) => activity.id === "evt-warning-resolved",
    );

    expect(resolvedActivity?.payload).toMatchObject({
      key: "provider.retry",
      message: "Reconnected.",
      resolved: true,
    });
  });

  it("maps session/thread lifecycle and item.started into session/activity projections", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emit({
      type: "session.started",
      eventId: asEventId("evt-session-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      message: "session started",
    });
    harness.emit({
      type: "thread.started",
      eventId: asEventId("evt-thread-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
    });
    harness.emit({
      type: "item.started",
      eventId: asEventId("evt-tool-started"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-9"),
      itemId: asItemId("tool-call-9"),
      payload: {
        itemType: "command_execution",
        status: "inProgress",
        title: "Command run",
        detail: "Bash: vp test run",
        data: {
          toolName: "Bash",
          input: { command: "vp test run" },
        },
      },
    });

    const thread = await waitForThread(
      harness,
      (entry) =>
        entry.session?.status === "ready" &&
        entry.session?.activeTurnId === null &&
        entry.activities.some(
          (activity: ProviderRuntimeTestActivity) => activity.kind === "tool.started",
        ),
    );

    expect(thread.session?.status).toBe("ready");

    const activity = thread.activities.find(
      (entry: ProviderRuntimeTestActivity) => entry.kind === "tool.started",
    );

    const payload = activity?.payload as Record<string, Schema.Json> | undefined;
    expect(payload).toMatchObject({
      itemType: "command_execution",
      toolCallId: "tool-call-9",
      status: "inProgress",
      detail: "Bash: vp test run",
      data: {
        toolName: "Bash",
        input: { command: "vp test run" },
      },
    });
  });

  it("continues processing runtime events after a single event handler failure", async () => {
    const harness = await createHarness();
    const now = "2026-01-01T00:00:00.000Z";

    harness.emitUnsafe({
      type: "content.delta",
      eventId: asEventId("evt-invalid-delta"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: now,
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-invalid"),
      itemId: asItemId("item-invalid"),
      payload: {
        streamKind: "assistant_text",
        delta: undefined,
      },
    });

    harness.emit({
      type: "runtime.error",
      eventId: asEventId("evt-runtime-error-after-failure"),
      provider: ProviderDriverKind.make("codex"),
      createdAt: "2026-01-01T00:00:00.000Z",
      threadId: asThreadId("thread-1"),
      turnId: asTurnId("turn-after-failure"),
      payload: {
        message: "runtime still processed",
      },
    });

    const thread = await waitForThread(
      harness,
      (entry) =>
        entry.session?.status === "error" &&
        entry.session?.activeTurnId === "turn-after-failure" &&
        entry.session?.lastError === "runtime still processed",
    );

    expect(thread.session?.status).toBe("error");
    expect(thread.session?.lastError).toBe("runtime still processed");
  });
});
