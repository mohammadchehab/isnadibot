import {
  CommandId,
  EventId,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  type OrchestrationEvent,
  type ThreadId,
  type TurnId,
} from "@isnadi/contracts";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { HandoffReactor, type HandoffReactorShape } from "../Services/HandoffReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { settledTurnStateForSessionStatus } from "../TurnSessionState.ts";

const isInvariantError = Schema.is(OrchestrationCommandInvariantError);

/** A turn that ended, and how it ended. */
interface EndedTurn {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly state: "completed" | "interrupted" | "error";
}

const makeHandoffReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  // The turn a chat is on, so the session leaving "running" can name the turn
  // that ended. The session-set that ends a turn carries no active turn.
  const lastTurnId = new Map<string, TurnId>();

  const appendNotApplied = (ended: EndedTurn, detail: string) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => {
        const createdAt = DateTime.formatIso(now);

        return orchestrationEngine.dispatch({
          type: "thread.activity.append",
          // One line per turn: a session that leaves "running" twice for the
          // same turn must not say so twice.
          commandId: CommandId.make(`server:handoff-not-applied:${ended.turnId}`),
          threadId: ended.threadId,
          activity: {
            id: EventId.make(`handoff-not-applied:${ended.turnId}`),
            tone: "info",
            kind: HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
            summary: "Hand off was interrupted, so nothing reset. The note stays in the chat.",
            payload: { turnId: ended.turnId, state: ended.state, detail },
            turnId: ended.turnId,
            createdAt,
          },
          createdAt,
        });
      }),
    );

  const advance = (ended: EndedTurn) => {
    const getHandoffTurn = projectionSnapshotQuery.getHandoffTurn;

    if (getHandoffTurn === undefined) return Effect.void;

    return getHandoffTurn({ threadId: ended.threadId, turnId: ended.turnId }).pipe(
      Effect.flatMap(
        Option.match({
          // The turn wrote no note, so it asked for no cut.
          onNone: () => Effect.void,
          onSome: (handoff) => {
            if (ended.state !== "completed") {
              return appendNotApplied(ended, "The turn did not complete.");
            }

            // A handoff turn that opened the chat has nothing behind it to
            // forget, so it owes no cut either.
            const sinceMessageId = handoff.sinceMessageId;

            if (sinceMessageId === null) return Effect.void;

            return DateTime.now.pipe(
              Effect.flatMap((now) =>
                orchestrationEngine.dispatch({
                  type: "thread.context.reset",
                  // One cut per turn, so a replayed turn end lands the same cut.
                  commandId: CommandId.make(`server:handoff:${ended.turnId}`),
                  threadId: ended.threadId,
                  botId: handoff.botId,
                  sinceMessageId,
                  handoffActivityId: handoff.activityId,
                  createdAt: DateTime.formatIso(now),
                }),
              ),
            );
          },
        }),
      ),
      // A cut the chat can no longer make (a revert removed the message the
      // turn ended on) leaves the bot on the whole chat, which is the state it
      // was in before the handoff. Nothing was reset, so nothing is said.
      Effect.catchIf(isInvariantError, (error) =>
        Effect.logInfo("handoff cut was refused", {
          threadId: ended.threadId,
          turnId: ended.turnId,
          commandType: error.commandType,
          failure: error.failure,
          detail: error.detail,
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("handoff cut could not be read", {
              threadId: ended.threadId,
              turnId: ended.turnId,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  };

  const worker = yield* makeDrainableWorker((ended: EndedTurn) => advance(ended));
  const seenSequence = yield* SubscriptionRef.make(0);

  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const observe = (event: OrchestrationEvent) => {
    if (event.type === "thread.turn-diff-completed") {
      lastTurnId.set(event.payload.threadId, event.payload.turnId);

      return Effect.void;
    }

    if (event.type !== "thread.session-set") return Effect.void;

    const { threadId, session } = event.payload;

    if (session.activeTurnId !== null) {
      lastTurnId.set(threadId, session.activeTurnId);

      return Effect.void;
    }

    const turnId = lastTurnId.get(threadId);
    const state = settledTurnStateForSessionStatus(session.status);

    if (turnId === undefined || state === null) return Effect.void;

    lastTurnId.delete(threadId);

    return worker.enqueue({ threadId, turnId, state });
  };

  const start: HandoffReactorShape["start"] = Effect.fn("start")(function* () {
    // Subscribe before reading so no event between the read and the first delivery is missed.
    const domainEvents = yield* orchestrationEngine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(domainEvents, (event) =>
        observe(event).pipe(Effect.andThen(noteSeen(event.sequence))),
      ),
    );
  });

  const drainThrough: HandoffReactorShape["drainThrough"] = Effect.fn(
    "HandoffReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* worker.drain;
  });

  return { start, drain: worker.drain, drainThrough } satisfies HandoffReactorShape;
});

export const HandoffReactorLive = Layer.effect(HandoffReactor, makeHandoffReactor);
