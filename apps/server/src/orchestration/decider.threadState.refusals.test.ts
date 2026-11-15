import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import { NOW, createSession, makeReadModel } from "./test-support/SettledDeciderFixtures.ts";

/**
 * Every thread-state refusal in the settle/snooze, pin/resume and channel
 * families carries one of three closed codes, so a client picks its own copy
 * instead of rendering the invariant sentence. The prose stays on `detail` as
 * the fallback for a client that does not know the code, so each case below
 * asserts both: the code the surface switches on, and the sentence older clients
 * still read.
 *
 * The decider's clock is the Effect test clock, pinned to the epoch: every
 * timestamp below is relative to 1970-01-01T00:00:00.000Z.
 */
const THREAD_ID = ThreadId.make("thread-1");

const MESSAGE_ID = MessageId.make("message-1");

/** Inside the two-minute adoption window before the epoch-pinned clock. */
const QUEUED_AT = "1969-12-31T23:59:30.000Z";

/** A wake time the epoch-pinned clock still reads as the future. */
const FUTURE = "1970-01-02T00:00:00.000Z";

/** A wake time the epoch-pinned clock has already passed. */
const PAST = "1969-12-31T00:00:00.000Z";

it.layer(NodeServices.layer)("thread-state refusals", (it) => {
  const decide = (command: OrchestrationCommand, readModel: OrchestrationReadModel) =>
    decideOrchestrationCommand({ command, readModel }).pipe(Effect.flip);

  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  /** A thread model with one field of its single thread replaced. */
  const threadModel = (
    patch: Partial<OrchestrationReadModel["threads"][number]>,
  ): OrchestrationReadModel => {
    const base = makeReadModel(null);

    return { ...base, threads: [{ ...base.threads[0]!, ...patch }] };
  };

  const requestActivity = (
    kind: string,
    requestId: string,
  ): OrchestrationThread["activities"][number] =>
    ({
      id: EventId.make(`activity-${requestId}-${kind}`),
      tone: "approval" as const,
      kind,
      summary: kind,
      payload: { requestId },
      turnId: null,
      createdAt: NOW,
    }) as OrchestrationThread["activities"][number];

  const userMessage = (
    createdAt: string,
    id: MessageId = MESSAGE_ID,
  ): OrchestrationThread["messages"][number] => ({
    id,
    role: "user",
    text: "Continue",
    turnId: null,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  });

  const settle = (suffix: string, readModel: OrchestrationReadModel = makeReadModel(null)) =>
    decide(
      {
        type: "thread.settle",
        commandId: CommandId.make(`cmd-settle-${suffix}`),
        threadId: THREAD_ID,
      },
      readModel,
    );

  const snooze = (suffix: string, snoozedUntil: string, readModel: OrchestrationReadModel) =>
    decide(
      {
        type: "thread.snooze",
        commandId: CommandId.make(`cmd-snooze-${suffix}`),
        threadId: THREAD_ID,
        snoozedUntil,
      },
      readModel,
    );

  // ---------------------------------------------------------------- busy (5)

  it.effect("codes a settle of a chat whose session is coming alive or working", () =>
    Effect.gen(function* () {
      for (const status of ["starting", "running"] as const) {
        const error = yield* settle(
          `live-${status}`,
          makeReadModel(null, null, createSession(status)),
        );

        const { refusal, detail } = refusalOf(error);

        // Live work is the reason, so the remedy is to wait for it rather than
        // to refresh: the client's picture of the chat is not stale.
        expect(refusal).toBe("thread-is-busy");
        expect(detail).toContain("active session");
      }
    }),
  );

  it.effect("codes a settle of a chat blocked on an approval or user-input request", () =>
    Effect.gen(function* () {
      for (const [kind, requestId] of [
        ["approval.requested", "req-approval"],
        ["user-input.requested", "req-input"],
      ] as const) {
        const error = yield* settle(
          `pending-${requestId}`,
          makeReadModel(null, null, null, [requestActivity(kind, requestId)]),
        );

        const { refusal, detail } = refusalOf(error);

        // A pending request is the agent waiting on the user, so the same
        // "there is work in flight" remedy applies.
        expect(refusal).toBe("thread-is-busy");
        expect(detail).toContain("pending approval or user-input request");
      }
    }),
  );

  it.effect("codes a settle of a chat whose just-sent turn no turn has adopted", () =>
    Effect.gen(function* () {
      const error = yield* settle(
        "queued",
        makeReadModel(null, null, null, [], [userMessage(QUEUED_AT)]),
      );

      const { refusal, detail } = refusalOf(error);

      // The user just sent a message; a settle would hide it before any turn
      // picked it up.
      expect(refusal).toBe("thread-is-busy");
      expect(detail).toContain("queued turn start");
    }),
  );

  it.effect("codes a snooze of a chat blocked on an approval or user-input request", () =>
    Effect.gen(function* () {
      const error = yield* snooze(
        "pending-approval",
        FUTURE,
        makeReadModel(null, null, null, [requestActivity("approval.requested", "req-snooze")]),
      );

      const { refusal, detail } = refusalOf(error);

      // Snooze only affects visibility, so a running session is snoozable —
      // a request that waits on the user is not.
      expect(refusal).toBe("thread-is-busy");
      expect(detail).toContain("cannot be snoozed");
    }),
  );

  it.effect("codes a snooze of a chat whose just-sent turn no turn has adopted", () =>
    Effect.gen(function* () {
      const error = yield* snooze(
        "queued",
        FUTURE,
        makeReadModel(null, null, null, [], [userMessage(QUEUED_AT)]),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("thread-is-busy");
      expect(detail).toContain("queued turn start");
    }),
  );

  // ------------------------------------------------------- state invalid (6)

  it.effect("codes a snooze whose wake time has already passed", () =>
    Effect.gen(function* () {
      const error = yield* snooze("past", PAST, makeReadModel(null));

      const { refusal, detail } = refusalOf(error);

      // Nothing is in flight to wait for; the client offered a state the server
      // cannot reach, so the remedy is to refresh and pick a real time.
      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("is not in the future");
    }),
  );

  it.effect("codes a pin reorder on a chat that is not pinned", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.pin.reorder",
          commandId: CommandId.make("cmd-reorder-unpinned"),
          threadId: THREAD_ID,
          orderKey: "a0",
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      // The pin order is stale because the chat was unpinned elsewhere.
      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("is not pinned and cannot be reordered");
    }),
  );

  it.effect("codes a hop budget change on a chat that is not a group chat", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.hop-budget.set",
          commandId: CommandId.make("cmd-hop-budget-direct"),
          threadId: THREAD_ID,
          hopBudget: 3,
          createdAt: NOW,
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("is not a group chat");
    }),
  );

  it.effect("codes a history restore that already matches the chat", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.history.restore",
          commandId: CommandId.make("cmd-restore-unchanged"),
          threadId: THREAD_ID,
          messages: [],
          proposedPlans: [],
          activities: [],
          settledOverride: null,
          settledAt: null,
          snoozedUntil: null,
          snoozedAt: null,
          pinnedAt: null,
          pinOrderKey: null,
          archivedAt: null,
          updatedAt: NOW,
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("history already matches the restore command");
    }),
  );

  it.effect("codes a resume of a chat with no interrupted request", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.turn.resume",
          commandId: CommandId.make("cmd-resume-nothing"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("does not have an interrupted request to resume");
    }),
  );

  it.effect("codes a resume of a chat that is already active", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.turn.resume",
          commandId: CommandId.make("cmd-resume-active"),
          threadId: THREAD_ID,
          createdAt: NOW,
        },
        threadModel({
          session: createSession("running"),
          latestTurn: {
            turnId: TurnId.make("turn-1"),
            state: "interrupted",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: null,
            assistantMessageId: null,
          },
        }),
      );

      const { refusal, detail } = refusalOf(error);

      // There IS something to resume, so this is not the "nothing to resume"
      // refusal: the chat already picked it back up.
      expect(refusal).toBe("thread-state-invalid");
      expect(detail).toContain("is already active");
    }),
  );

  // ------------------------------------------- channel delivery unavailable (2)

  it.effect("codes channel delivery on a message that is not a bot reply", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.channel-delivery.set",
          commandId: CommandId.make("cmd-delivery-user-message"),
          threadId: THREAD_ID,
          messageId: MESSAGE_ID,
          delivery: "sent",
          createdAt: NOW,
        },
        makeReadModel(null, null, null, [], [userMessage(QUEUED_AT)]),
      );

      const { refusal, detail } = refusalOf(error);

      // There is nothing for the user to do: the surface offered an action that
      // cannot apply to this message.
      expect(refusal).toBe("channel-delivery-unavailable");
      expect(detail).toContain("can only mark an assistant message");
    }),
  );

  it.effect("codes an inbound channel message on a delegated chat", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-channel-child"),
          threadId: THREAD_ID,
          message: {
            messageId: MESSAGE_ID,
            role: "user",
            text: "Hello from the channel",
            attachments: [],
            channelOrigin: { provider: "telegram", externalThreadId: "ext-thread-1" },
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        threadModel({ parentThreadId: ThreadId.make("thread-parent") }),
      );

      const { refusal, detail } = refusalOf(error);

      // A delegated child runs under its parent's turn, so it has no turn of its
      // own for an inbound channel message to land in.
      expect(refusal).toBe("channel-delivery-unavailable");
      expect(detail).toContain("cannot receive channel messages");
    }),
  );

  // ------------------------------- plan source and misplaced mentions (4)

  /** A turn-start whose plan comes from a thread this model may or may not hold. */
  const turnStartFromPlan = (
    suffix: string,
    sourceThreadId: ThreadId,
    planId: string,
    readModel: OrchestrationReadModel,
  ) =>
    decide(
      {
        type: "thread.turn.start",
        commandId: CommandId.make(`cmd-turn-start-${suffix}`),
        threadId: THREAD_ID,
        message: {
          messageId: MESSAGE_ID,
          role: "user",
          text: "Build the plan",
          attachments: [],
        },
        sourceProposedPlan: { threadId: sourceThreadId, planId },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: NOW,
      },
      readModel,
    );

  it.effect("codes a turn start whose proposed plan is gone as a stale view", () =>
    Effect.gen(function* () {
      // The plan is named on this thread, which holds none: the client accepted
      // a plan the server has already dropped, so a refresh is the remedy.
      const error = yield* turnStartFromPlan(
        "plan-gone",
        THREAD_ID,
        "plan-gone",
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("stale-view");
      expect(detail).toContain("does not exist on thread");
    }),
  );

  it.effect("codes a turn start whose plan belongs to another project as a stale view", () =>
    Effect.gen(function* () {
      const sourceThreadId = ThreadId.make("thread-source");
      const base = makeReadModel(null);
      const target = base.threads[0]!;

      // The source thread holds the plan, but under a different project, so the
      // accepted plan cannot be started here — again a view the server has left.
      const readModel: OrchestrationReadModel = {
        ...base,
        threads: [
          target,
          {
            ...target,
            id: sourceThreadId,
            projectId: ProjectId.make("project-other"),
            proposedPlans: [
              {
                id: "plan-1",
                turnId: null,
                planMarkdown: "# Plan",
                implementedAt: null,
                implementationThreadId: null,
                createdAt: NOW,
                updatedAt: NOW,
              },
            ],
          },
        ],
      };

      const error = yield* turnStartFromPlan(
        "plan-other-project",
        sourceThreadId,
        "plan-1",
        readModel,
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("stale-view");
      expect(detail).toContain("different project");
    }),
  );

  it.effect("codes bot mentions on a chat that is not a space chat", () =>
    Effect.gen(function* () {
      // A composer's addressing state can outlive the space chat it was set in,
      // so the chat is fine and the mention is misplaced: remove it and resend.
      const error = yield* decide(
        {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start-mentions"),
          threadId: THREAD_ID,
          message: {
            messageId: MESSAGE_ID,
            role: "user",
            text: "Ask both of you",
            attachments: [],
          },
          addressing: { kind: "auto" },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: NOW,
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("thread-does-not-take-mentions");
      expect(detail).toContain("group-owned thread");
    }),
  );

  it.effect("codes a reaction on a message the chat no longer holds as a stale view", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-reaction-gone"),
          threadId: THREAD_ID,
          messageId: MessageId.make("message-gone"),
          emoji: "thumbs-up",
          present: true,
          updatedAt: NOW,
        },
        makeReadModel(null),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("stale-view");
      expect(detail).toContain("is not visible in thread");
    }),
  );
});
