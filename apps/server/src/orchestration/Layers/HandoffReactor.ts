import {
  CommandId,
  EventId,
  HANDOFF_APPLIED_ACTIVITY_KIND,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  type BotId,
  type HandoffNotAppliedReason,
  type MessageId,
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

/**
 * What the chat says for each reason a requested hand off reset nothing. The
 * note is the only thing a hand off leaves behind, so every sentence says
 * whether there is one to keep.
 */
const NOT_APPLIED_SUMMARY: Record<HandoffNotAppliedReason, string> = {
  "no-note": "Hand off did not happen: the bot wrote no note, so nothing reset.",
  "turn-not-completed": "Hand off was interrupted, so nothing reset. The note stays in the chat.",
  "reset-refused":
    "Hand off could not reset the context, because the chat changed. The note stays in the chat.",
};

const makeHandoffReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  // The turn a chat is on, so the session leaving "running" can name the turn
  // that ended. The session-set that ends a turn carries no active turn.
  const lastTurnId = new Map<string, TurnId>();

  /** Cuts one bot's context at the message before the handoff turn. */
  const cutContext = (
    ended: EndedTurn,
    botId: BotId,
    handoffActivityId: EventId,
    sinceMessageId: MessageId,
  ) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        orchestrationEngine.dispatch({
          type: "thread.context.reset",
          // One cut per turn, so a replayed turn end lands the same cut.
          commandId: CommandId.make(`server:handoff:${ended.turnId}`),
          threadId: ended.threadId,
          botId,
          sinceMessageId,
          handoffActivityId,
          createdAt: DateTime.formatIso(now),
        }),
      ),
      Effect.as(true),
      // A cut the chat can no longer make (a revert removed the message the turn
      // ended on) leaves the bot on the whole chat, which is the state it was in
      // before the handoff. Nothing was reset, and the caller says so.
      Effect.catchIf(isInvariantError, (error) =>
        Effect.logInfo("handoff cut was refused", {
          threadId: ended.threadId,
          turnId: ended.turnId,
          commandType: error.commandType,
          failure: error.failure,
          detail: error.detail,
        }).pipe(Effect.as(false)),
      ),
    );

  const appendNotApplied = (ended: EndedTurn, botId: BotId, reason: HandoffNotAppliedReason) =>
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
            summary: NOT_APPLIED_SUMMARY[reason],
            payload: { botId, turnId: ended.turnId, reason },
            turnId: ended.turnId,
            createdAt,
          },
          createdAt,
        });
      }),
    );

  // The cut lives in a server-side projection the clients never see, so the
  // chat's own record of it is this activity: it is what the note's row renders
  // Undo and Hide from.
  const appendApplied = (ended: EndedTurn, botId: BotId, handoffActivityId: EventId) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => {
        const createdAt = DateTime.formatIso(now);

        return orchestrationEngine.dispatch({
          type: "thread.activity.append",
          // One line per turn, so a replayed turn end lands the same row.
          commandId: CommandId.make(`server:handoff-applied:${ended.turnId}`),
          threadId: ended.threadId,
          activity: {
            id: EventId.make(`handoff-applied:${ended.turnId}`),
            tone: "info",
            kind: HANDOFF_APPLIED_ACTIVITY_KIND,
            summary: "Handed off. This bot's context starts at the note.",
            payload: { botId, turnId: ended.turnId, handoffActivityId },
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
          // Nobody asked for a note and none was written, so the turn owes the
          // chat nothing.
          onNone: () => Effect.void,
          onSome: (handoff) => {
            const { activityId, botId, requested, sinceMessageId } = handoff;

            if (activityId === null) {
              // A turn the server asked to hand off that ended without a note. A
              // note the bot volunteers is not a request, so its absence is not
              // news.
              return requested ? appendNotApplied(ended, botId, "no-note") : Effect.void;
            }

            if (ended.state !== "completed") {
              return appendNotApplied(ended, botId, "turn-not-completed");
            }

            // A turn that opened the chat has nothing behind it to forget: the
            // bot's context already starts at the note.
            const cut =
              sinceMessageId === null
                ? Effect.succeed(true)
                : cutContext(ended, botId, activityId, sinceMessageId);

            return cut.pipe(
              Effect.flatMap((landed) =>
                // Only a requested hand off is a row the user can undo, so only
                // that one is recorded; a note the bot wrote on its own still
                // cuts, silently, exactly as it did before the request existed.
                requested
                  ? landed
                    ? appendApplied(ended, botId, activityId)
                    : appendNotApplied(ended, botId, "reset-refused")
                  : Effect.void,
              ),
            );
          },
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
