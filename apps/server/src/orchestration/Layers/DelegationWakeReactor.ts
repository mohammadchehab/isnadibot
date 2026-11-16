import {
  CommandId,
  MessageId,
  isIsnadiDelegationResultPending,
  isThreadWaitingOnChildren,
  type DelegationId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@isnadi/contracts";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import { isLiveSessionStatus } from "@isnadi/shared/botStatus";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  DelegationWakeReactor,
  type DelegationWakeReactorShape,
} from "../Services/DelegationWakeReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

const isInvariantError = Schema.is(OrchestrationCommandInvariantError);

// What can make a boss ready to wake: a result landing, or its own turn ending.
const wakesOn = (event: OrchestrationEvent) =>
  event.type === "delegation.created" ||
  event.type === "delegation.updated" ||
  event.type === "thread.session-set" ||
  event.type === "thread.turn-diff-completed";

const makeDelegationWakeReactor = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const wake = (thread: OrchestrationThread, delegationIds: ReadonlyArray<DelegationId>) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            orchestrationEngine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make(`server:delegation-wake:${uuid}`),
              threadId: thread.id,
              message: {
                messageId: MessageId.make(`delegation-wake:${uuid}`),
                role: "user",
                text: "Your delegated work has finished. Review the results and reply.",
                attachments: [],
              },
              // The chat's own runtime mode, never a raised one.
              runtimeMode: thread.runtimeMode,
              interactionMode: "default",
              // The decider acknowledges the pending results when this turn starts.
              trigger: { kind: "delegation-results" },
              createdAt: DateTime.formatIso(now),
            }),
          ),
        ),
      ),
      // This catch covers the whole invariant class, so a benign lifecycle no-op (an archived bot,
      // a vanished chat, a turn that already started) arrives here exactly like an authorization
      // refusal. `failure` names the arm and its code, and that code is the only thing that tells
      // them apart: a refused wake becomes no event, no receipt and no counter, so without this
      // line it leaves no trace at all.
      Effect.catchIf(isInvariantError, (error) =>
        Effect.logInfo("delegation wake was refused", {
          threadId: thread.id,
          delegationIds,
          bossSessionStatus: thread.session?.status ?? "none",
          commandType: error.commandType,
          failure: error.failure,
          detail: error.detail,
        }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("delegation wake could not start a turn", {
              threadId: thread.id,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // A boss is owed a wake when results are pending, nothing it delegated is still open, and it is
  // not mid-turn (a live turn acknowledges them itself when the next one starts). The pending
  // delegations travel with the wake, so a refusal can name the work it was about.
  const sweep = projectionSnapshotQuery.getCommandReadModel().pipe(
    Effect.flatMap((readModel) => {
      const due = readModel.threads.flatMap((thread) => {
        if (thread.deletedAt !== null) return [];

        if (thread.session !== null && isLiveSessionStatus(thread.session.status)) return [];

        if (isThreadWaitingOnChildren(readModel.delegations, thread.id)) return [];

        const pending = readModel.delegations.filter(
          (delegation) =>
            delegation.parentThreadId === thread.id && isIsnadiDelegationResultPending(delegation),
        );

        if (pending.length === 0) return [];

        return [{ thread, delegationIds: pending.map((delegation) => delegation.delegationId) }];
      });

      return Effect.forEach(due, ({ thread, delegationIds }) => wake(thread, delegationIds), {
        discard: true,
      });
    }),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("delegation wake could not read the read model", {
            cause: Cause.pretty(cause),
          }),
    ),
  );

  const worker = yield* makeDrainableWorker(() => sweep);
  const seenSequence = yield* SubscriptionRef.make(0);

  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const start: DelegationWakeReactorShape["start"] = Effect.fn("start")(function* () {
    // Subscribe before reading so no event between the read and the first delivery is missed.
    const domainEvents = yield* orchestrationEngine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(domainEvents, (event) =>
        (wakesOn(event) ? worker.enqueue(undefined) : Effect.void).pipe(
          Effect.andThen(noteSeen(event.sequence)),
        ),
      ),
    );
    // Results that finished while the server was down still owe their boss a turn.
    yield* worker.enqueue(undefined);
  });

  const drainThrough: DelegationWakeReactorShape["drainThrough"] = Effect.fn(
    "DelegationWakeReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* worker.drain;
  });

  return { start, drain: worker.drain, drainThrough } satisfies DelegationWakeReactorShape;
});

export const DelegationWakeReactorLive = Layer.effect(
  DelegationWakeReactor,
  makeDelegationWakeReactor,
);
