import { Predicate } from "effect";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentNotRegisteredError } from "@isnadi/client-runtime/connection";
import { isTransportConnectionErrorMessage } from "@isnadi/client-runtime/errors";
import { EnvironmentRpcUnavailableError } from "@isnadi/client-runtime/rpc";
import { commandRefusalDescription } from "@isnadi/client-runtime/state/runtime";
import {
  EnvironmentAuthorizationError,
  EnvironmentId,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
} from "@isnadi/contracts";
import * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import * as Socket from "effect/unstable/socket/Socket";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  groupQueuedThreadMessages,
  isQueuedThreadCreationSendable,
  modelSelectionsEqual,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxFailureAction,
  resolveQueuedThreadSettings,
  SELF_CLEARING_THREAD_OUTBOX_REFUSALS,
  shouldRetryThreadOutboxDelivery,
  threadOutboxHydrationRetryDelayMs,
  threadOutboxRetryDelayMs,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { persistQueuedThreadFailure } from "./thread-outbox-failure";
import { queuedMessage } from "./thread-outbox.test-support";

describe("thread outbox", () => {
  it("groups messages by scoped thread and preserves creation order", () => {
    const later = queuedMessage({
      messageId: "message-2",
      createdAt: "2026-06-08T10:00:02.000Z",
    });

    const earlier = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    expect(groupQueuedThreadMessages([later, earlier])).toEqual({
      "environment-1:thread-1": [earlier, later],
    });
  });

  it("decodes the persisted schema and rejects incomplete messages", () => {
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    expect(
      decodeQueuedThreadMessage({
        schemaVersion: 1,
        ...message,
      }),
    ).toEqual(message);
    expect(() =>
      decodeQueuedThreadMessage({
        schemaVersion: 1,
        environmentId: "environment-1",
      }),
    ).toThrow();
  });

  it("persists the exact selector snapshot while remaining compatible with v1 messages", () => {
    const legacyMessage = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    const selectedMessage = {
      ...legacyMessage,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
      runtimeMode: "approval-required",
      interactionMode: "plan",
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(selectedMessage))).toEqual(
      selectedMessage,
    );
    expect(
      resolveQueuedThreadSettings(legacyMessage, {
        modelSelection: selectedMessage.modelSelection,
        runtimeMode: selectedMessage.runtimeMode,
        interactionMode: selectedMessage.interactionMode,
      }),
    ).toEqual({
      modelSelection: selectedMessage.modelSelection,
      runtimeMode: selectedMessage.runtimeMode,
      interactionMode: selectedMessage.interactionMode,
    });
  });

  it("compares model options as part of the queued settings change", () => {
    const base = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "medium" }],
    } as const;

    expect(modelSelectionsEqual(base, base)).toBe(true);
    expect(
      modelSelectionsEqual(base, {
        ...base,
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      }),
    ).toBe(false);
  });

  it("backs off queued delivery retries and caps them at sixteen seconds", () => {
    expect([1, 2, 3, 4, 5, 6].map(threadOutboxRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 16_000,
    ]);
  });

  it("only removes a missing-thread message after shell synchronization is live", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: false,
        shellStatus: "synchronizing",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("wait");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: false,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("remove");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("send");
  });

  it("sends existing-thread messages whenever connected so queued messages can steer", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: true,
      }),
    ).toBe("send");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: false,
        threadBusy: true,
      }),
    ).toBe("wait");
  });

  it("sends queued creations once connected and live, removing already-created ones", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "cached",
        environmentConnected: false,
        threadBusy: false,
      }),
    ).toBe("wait");
    // Connected but not yet synchronized: a previously delivered creation may
    // simply not be visible yet — sending now could duplicate the thread.
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "synchronizing",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("wait");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("send");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: true,
      }),
    ).toBe("remove");
  });

  it("round-trips queued creations and gates incomplete ones from sending", () => {
    const base = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    const creationMessage = {
      ...base,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "worktree",
        branch: "main",
        worktreePath: null,
        startFromOrigin: true,
      },
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(creationMessage))).toEqual(
      creationMessage,
    );
    expect(isQueuedThreadCreationSendable(creationMessage)).toBe(true);
    expect(
      isQueuedThreadCreationSendable({
        ...creationMessage,
        creation: { ...creationMessage.creation, branch: null },
      }),
    ).toBe(false);
    expect(
      isQueuedThreadCreationSendable({
        ...creationMessage,
        creation: { ...creationMessage.creation, branch: "" },
      }),
    ).toBe(false);
    expect(isQueuedThreadCreationSendable({ ...creationMessage, modelSelection: undefined })).toBe(
      false,
    );
    expect(isQueuedThreadCreationSendable(base)).toBe(false);
  });

  it("retries transport failures but drops deterministic command failures", () => {
    expect(shouldRetryThreadOutboxDelivery(new Error("Socket is not connected"))).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery({
        _tag: "ConnectionTransientError",
        message: "temporarily unavailable",
      }),
    ).toBe(true);
    expect(shouldRetryThreadOutboxDelivery(new Error("Thread no longer exists"))).toBe(false);
    expect(
      shouldRetryThreadOutboxDelivery(
        new OrchestrationDispatchCommandError({ message: "Thread no longer exists" }),
      ),
    ).toBe(false);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentAuthorizationError({
          message: "Missing scope",
          requiredScope: "orchestration:operate",
        }),
      ),
    ).toBe(false);
  });

  it("bounds incomplete outbox hydration retries", () => {
    expect([0, 1, 2, 3].map(threadOutboxHydrationRetryDelayMs)).toEqual([250, 1_000, 4_000, null]);
  });

  // A pending task created offline drains the moment the phone reconnects,
  // which is exactly when the socket is most likely to drop again. Every way a
  // request can fail in flight must retry; a restore turns the pending task
  // into a draft and it disappears from the list.
  it("retries every in-flight transport failure by tag, not by message text", () => {
    const socketReasons = [
      new Socket.SocketReadError({ cause: new Error("The network connection was lost.") }),
      new Socket.SocketWriteError({ cause: new Error("Broken pipe") }),
      new Socket.SocketCloseError({ code: 1006 }),
      new Socket.SocketOpenError({ kind: "Timeout", cause: new Error("timeout") }),
    ];

    for (const reason of socketReasons) {
      const error = new RpcClientError.RpcClientError({ reason });
      expect(isTransportConnectionErrorMessage(error.message)).toBe(
        Predicate.isTagged(reason, "SocketCloseError") ||
          Predicate.isTagged(reason, "SocketOpenError"),
      );
      expect(shouldRetryThreadOutboxDelivery(error)).toBe(true);
    }

    expect(
      shouldRetryThreadOutboxDelivery(
        new RpcClientError.RpcClientError({
          reason: new RpcClientError.RpcClientDefect({
            message: "Error decoding message",
            cause: new Error("Unexpected end of JSON input"),
          }),
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentRpcUnavailableError({
          environmentId: "environment-1",
          message: "Home is not connected.",
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentNotRegisteredError({ environmentId: EnvironmentId.make("environment-1") }),
      ),
    ).toBe(true);
  });

  it("retains queued messages when settings synchronization fails before startTurn", () => {
    const deterministicFailure = new Error("Thread no longer exists");

    expect(
      resolveThreadOutboxFailureAction({
        stage: "settings-sync",
        error: deterministicFailure,
        interrupted: false,
      }).action,
    ).toBe("retry");
    expect(
      resolveThreadOutboxFailureAction({
        stage: "start-turn",
        error: deterministicFailure,
        interrupted: false,
      }).action,
    ).toBe("discard");
  });
});

/** A refusal the server sent, with the sentence that carries its internal ids. */
const refusedSend = (refusal: string, message: string) =>
  new OrchestrationDispatchCommandError({ message, refusal });

const decide = (error: unknown) =>
  resolveThreadOutboxFailureAction({ stage: "start-turn", error, interrupted: false });

describe("queued message failures", () => {
  it("keeps a refused message with its reason instead of removing it", async () => {
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    const decision = decide(
      refusedSend(
        "group-has-no-responder",
        "Group 'group-product' has no boss bot that can respond.",
      ),
    );

    expect(decision.action).toBe("block");

    if (decision.action === "retry") {
      throw new Error("a refusal that needs a person must not retry");
    }

    const written: Array<QueuedThreadMessage> = [];

    await persistQueuedThreadFailure({
      message,
      failure: decision,
      now: "2026-06-08T10:00:09.000Z",
      update: async (next) => {
        written.push(next);

        return true;
      },
    });

    expect(written).toHaveLength(1);
    expect(written[0]?.text).toBe("message-1");
    expect(written[0]?.failure).toEqual({
      refusal: "group-has-no-responder",
      action: "block",
      at: "2026-06-08T10:00:09.000Z",
    });

    // The user reads the catalog sentence, not the server's prose and its ids.
    expect(
      commandRefusalDescription(
        "group-has-no-responder",
        "Group 'group-product' has no boss bot that can respond.",
      ),
    ).toBe("This space needs a boss. Choose which bot leads it.");
  });

  it("blocks a refusal that needs a person, and one it cannot name", () => {
    expect(decide(refusedSend("group-has-no-responder", "no boss"))).toEqual({
      action: "block",
      refusal: "group-has-no-responder",
    });
    expect(decide(refusedSend("actor-not-a-group-member", "not a member"))).toEqual({
      action: "block",
      refusal: "actor-not-a-group-member",
    });
    // A code a newer server added still blocks: the user is told and nothing is
    // lost, which fails safe against retrying forever.
    expect(decide(refusedSend("a-code-from-a-newer-server", "new reason"))).toEqual({
      action: "block",
      refusal: "unknown",
    });
  });

  it("retries a refusal whose condition clears on its own, and a dropped socket", () => {
    expect(decide(refusedSend("thread-is-busy", "work in flight"))).toEqual({ action: "retry" });
    expect(decide(new Error("Socket is not connected"))).toEqual({ action: "retry" });
    expect(
      resolveThreadOutboxFailureAction({
        stage: "start-turn",
        error: refusedSend("group-has-no-responder", "no boss"),
        interrupted: true,
      }),
    ).toEqual({ action: "retry" });
  });

  it("names the refusals that clear on their own instead of inferring them", () => {
    expect([...SELF_CLEARING_THREAD_OUTBOX_REFUSALS]).toEqual(["thread-is-busy"]);
  });

  it("takes an auth refusal down the blocking path", () => {
    expect(
      decide(
        new EnvironmentAuthorizationError({
          message: "Missing scope",
          requiredScope: "orchestration:operate",
        }),
      ),
    ).toEqual({ action: "block", refusal: "environment-rights" });
  });

  it("discards a failure that carries no refusal code at all", () => {
    expect(
      decide(new OrchestrationDispatchCommandError({ message: "Thread no longer exists" })),
    ).toEqual({ action: "discard", refusal: "unknown" });
  });

  it("decodes a stored v3 item as never failed", () => {
    const legacy = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    expect(decodeQueuedThreadMessage({ schemaVersion: 3, ...legacy })).toEqual(legacy);
  });

  it("round-trips a recorded failure", () => {
    const failed = {
      ...queuedMessage({ messageId: "message-1", createdAt: "2026-06-08T10:00:01.000Z" }),
      failure: {
        refusal: "group-has-no-responder",
        action: "block",
        at: "2026-06-08T10:00:09.000Z",
      },
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(failed))).toEqual(failed);
  });
});
