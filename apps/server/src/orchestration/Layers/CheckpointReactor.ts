import {
  TURN_WENT_SILENT_REFUSAL,
  type OrchestrationEvent,
  type ProviderRuntimeEvent,
} from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as PlatformError from "effect/PlatformError";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import { isLiveSessionStatus } from "@isnadi/shared/botStatus";
import { CheckpointReactor, type CheckpointReactorShape } from "../Services/CheckpointReactor.ts";
import { forkParked } from "../../serverActivation.ts";
import type { CheckpointStoreError } from "../../checkpointing/Errors.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import { nowIso, toTurnId, sameId, type ReactorInput } from "./checkpoint-reactor/Fields.ts";
import { createDependencies } from "./checkpoint-reactor/Dependencies.ts";
import { createFailures } from "./checkpoint-reactor/Failures.ts";
import { createContext } from "./checkpoint-reactor/Context.ts";
import { createCapture } from "./checkpoint-reactor/Capture.ts";
import { createWorkspace } from "./checkpoint-reactor/Workspace.ts";
import { createRevert } from "./checkpoint-reactor/Revert.ts";

const make = Effect.gen(function* () {
  const {
    randomUUID,
    serverEventId,
    serverCommandId,
    orchestrationEngine,
    projectionSnapshotQuery,
    agentController,
    checkpointStore,
    receiptBus,
    workspaceEntries,
    git,
    startedTurns,
    pending,
  } = yield* createDependencies();

  const { appendRevertFailureActivity, appendCaptureFailureActivity } = createFailures({
    serverCommandId,
    serverEventId,
    orchestrationEngine,
  });

  const { resolveSessionRuntimeForThread, resolveThreadCheckpointState } = createContext({
    agentController,
    projectionSnapshotQuery,
  });

  const {
    captureCheckpointForSettledTurn,
    captureCheckpointFromTurnCompletion,
    ensurePreTurnBaselineFromTurnStart,
    ensurePreTurnBaselineFromDomainTurnStart,
  } = createCapture({
    projectionSnapshotQuery,
    resolveSessionRuntimeForThread,
    checkpointStore,
    workspaceEntries,
    appendCaptureFailureActivity,
    orchestrationEngine,
    serverCommandId,
    receiptBus,
    randomUUID,
    resolveThreadCheckpointState,
  });

  const { statusRefreshWorker } = yield* createWorkspace({
    resolveSessionRuntimeForThread,
    git,
    projectionSnapshotQuery,
    orchestrationEngine,
    serverCommandId,
  });

  const { handleRevertRequested } = createRevert({
    resolveThreadCheckpointState,
    appendRevertFailureActivity,
    resolveSessionRuntimeForThread,
    checkpointStore,
    workspaceEntries,
    agentController,
    orchestrationEngine,
    serverCommandId,
  });

  const processDomainEvent = Effect.fn("processDomainEvent")(function* (event: OrchestrationEvent) {
    if (event.type === "thread.turn-start-requested" || event.type === "thread.message-sent") {
      if (event.type === "thread.turn-start-requested") pending.add(event.payload.threadId);
      yield* ensurePreTurnBaselineFromDomainTurnStart(event);

      return;
    }

    // A turn can reach a final-terminal state without its provider ever reporting an ending: when
    // a provider goes quiet on a live session, the silence watchdog settles the turn itself. That
    // ending arrives as the session leaving "running" with no active turn, so it settles the
    // checkpoint exactly like a provider-reported ending — otherwise a turn the provider abandoned
    // keeps no checkpoint and the work it did is never recoverable.
    if (event.type === "thread.session-set") {
      const { threadId, session } = event.payload;

      if (session.activeTurnId !== null || isLiveSessionStatus(session.status)) return;

      const settledTurnId = startedTurns.get(threadId);

      // Only the watchdog's settlement is this reactor's business: a turn the provider ended has
      // already been handled on the runtime path, and its session-set is the same ending arriving
      // twice.
      if (settledTurnId === undefined || session.lastErrorCode !== TURN_WENT_SILENT_REFUSAL) return;

      startedTurns.delete(threadId);

      yield* captureCheckpointForSettledTurn({
        threadId,
        turnId: settledTurnId,
        // The turn failed: the provider stopped answering. "error" is the same status a provider
        // that reports its own failure gets, so the turn row keeps reading as failed instead of
        // being rewritten to "completed" by the checkpoint it captured.
        status: "error",
        createdAt: event.occurredAt,
      });

      return;
    }

    if (event.type === "thread.checkpoint-revert-requested") {
      yield* handleRevertRequested(event).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            appendRevertFailureActivity({
              threadId: event.payload.threadId,
              turnCount: event.payload.turnCount,
              detail: error.message,
              createdAt,
            }),
          ),
        ),
      );
    }
  });

  const processRuntimeEvent = Effect.fn("processRuntimeEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    if (event.type === "session.exited") {
      startedTurns.delete(event.threadId);
      pending.delete(event.threadId);

      return;
    }

    if (event.type === "turn.started") {
      const turnId = toTurnId(event.turnId);

      const activeTurnId = (yield* agentController.listSessions()).find((session) =>
        sameId(session.threadId, event.threadId),
      )?.activeTurnId;

      const mayReplace = pending.has(event.threadId) && sameId(activeTurnId, turnId);

      if (turnId !== null && (!startedTurns.has(event.threadId) || mayReplace)) {
        startedTurns.set(event.threadId, turnId);
        pending.delete(event.threadId);
      }

      yield* ensurePreTurnBaselineFromTurnStart(event);

      return;
    }

    if (event.type === "turn.completed" || event.type === "turn.aborted") {
      const turnId = toTurnId(event.turnId);

      const thread = yield* projectionSnapshotQuery
        .getThreadRuntimeContext(event.threadId)
        .pipe(Effect.map(Option.getOrUndefined));

      const startedTurnId = startedTurns.get(event.threadId);
      const isTrackedTurn = sameId(startedTurnId, turnId);

      if (isTrackedTurn) startedTurns.delete(event.threadId);

      if (event.type === "turn.completed") {
        yield* statusRefreshWorker.enqueue(event);
      }

      if (isTrackedTurn || sameId(thread?.session?.activeTurnId, turnId)) {
        pending.delete(event.threadId);
      }

      if (
        event.type === "turn.aborted" &&
        !isTrackedTurn &&
        !sameId(thread?.session?.activeTurnId, turnId)
      ) {
        return;
      }

      yield* captureCheckpointFromTurnCompletion(event).pipe(
        Effect.catch((error) =>
          Effect.flatMap(nowIso, (createdAt) =>
            appendCaptureFailureActivity({
              threadId: event.threadId,
              turnId,
              detail: error.message,
              createdAt,
            }).pipe(Effect.catch(() => Effect.void)),
          ),
        ),
      );

      return;
    }
  });

  const processInput = (
    input: ReactorInput,
  ): Effect.Effect<
    void,
    CheckpointStoreError | OrchestrationDispatchError | PlatformError.PlatformError,
    never
  > =>
    input.source === "domain" ? processDomainEvent(input.event) : processRuntimeEvent(input.event);

  const processInputSafely = (input: ReactorInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }

        return Effect.logWarning("checkpoint reactor failed to process input", {
          source: input.source,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: CheckpointReactorShape["start"] = Effect.fn("start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
        if (
          event.type !== "thread.turn-start-requested" &&
          event.type !== "thread.message-sent" &&
          event.type !== "thread.checkpoint-revert-requested" &&
          event.type !== "thread.session-set"
        ) {
          return Effect.void;
        }

        return worker.enqueue({ source: "domain", event });
      }),
    );

    yield* forkParked(
      Stream.runForEach(agentController.streamEvents, (event) => {
        if (
          event.type !== "turn.started" &&
          event.type !== "turn.completed" &&
          event.type !== "turn.aborted" &&
          event.type !== "session.exited"
        ) {
          return Effect.void;
        }

        return worker.enqueue({ source: "runtime", event });
      }),
    );
  });

  return {
    start,
    drain: worker.drain.pipe(Effect.andThen(statusRefreshWorker.drain)),
  } satisfies CheckpointReactorShape;
});

export const CheckpointReactorLive = Layer.effect(CheckpointReactor, make);
