import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type BotId,
  CheckpointRef,
  EventId,
  ThreadId,
  TurnId,
  WorkItemId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type WorkItem,
} from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerActivation } from "../../serverActivation.ts";
import { type OrchestrationDispatchError } from "../Errors.ts";
import { FleetDispatcherReactor } from "../Services/FleetDispatcherReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { FleetDispatcherReactorLive } from "../Layers/FleetDispatcherReactor.ts";
import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "./GroupDeciderFixtures.ts";

export const NOW = "2026-01-01T00:00:00.000Z";

export const LATER = "2026-01-01T00:00:05.000Z";

export const LATEST = "2026-01-01T00:00:10.000Z";

export const BOT_THREAD = ThreadId.make("thread-bot-specialist");

/** Two specialists whose ids sort in the order the pick uses, spelled out to keep it obvious. */
export const BOT_A = makeBot({ id: "bot-a" as BotId, groupId: GROUP_ID });

export const BOT_B = makeBot({ id: "bot-b" as BotId, groupId: GROUP_ID });

/**
 * The dispatcher's own read model carries full threads that lack the pending flags: they are
 * computed only into the shell snapshot. The idle rule reads those fields, so the fixtures on its
 * path spell them out instead of pretending the command read model already has them.
 */
export type Ac3Thread = OrchestrationThread &
  Pick<OrchestrationThreadShell, "hasPendingApprovals" | "hasPendingUserInput">;

export const botThread = (botId: BotId, id: string): OrchestrationThread => ({
  ...makeGroupThread(),
  id: ThreadId.make(id),
  botId,
  groupId: null,
  session: null,
  latestTurn: null,
});

export const workItem = (input: {
  readonly id: string;
  readonly state?: WorkItem["state"];
  readonly ownerBotId?: BotId;
  readonly createdAt?: string;
}): WorkItem => ({
  id: WorkItemId.make(input.id),
  groupId: GROUP_ID,
  title: `Item ${input.id}`,
  brief: "Fix the thing.",
  kind: "task",
  state: input.state ?? "queued",
  ...(input.ownerBotId === undefined ? {} : { ownerBotId: input.ownerBotId }),
  createdAt: input.createdAt ?? NOW,
  updatedAt: NOW,
});

export const keepBusyGroup = (
  input: {
    readonly bossBotId?: OrchestrationGroup["bossBotId"];
    readonly members?: OrchestrationGroup["members"];
  } = {},
): OrchestrationGroup => ({ ...makeGroup(input), keepBusy: true });

/** One idle specialist in a keep-busy group, with its own chat and nothing queued. */
export const idleTeamModel = (items: ReadonlyArray<WorkItem> = []): OrchestrationReadModel => ({
  ...makeReadModel({
    bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
    groups: [keepBusyGroup()],
    threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
  }),
  workItems: items,
});

export const base = (sequence: number, eventType: string) => ({
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  occurredAt: NOW,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  aggregateKind: eventType.startsWith("group.") ? ("group" as const) : ("thread" as const),
  aggregateId: eventType.startsWith("group.") ? GROUP_ID : BOT_THREAD,
});

export const sessionSet = (
  sequence: number,
  threadId: ThreadId,
  status: "running" | "ready" | "error",
  activeTurnId: TurnId | null = null,
) =>
  ({
    ...base(sequence, "thread.session-set"),
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId,
        lastError: null,
        updatedAt: NOW,
      },
    },
  }) satisfies OrchestrationEvent;

/** The turn-end the dispatcher also has to honour: a diff finishing, with the session still up. */
export const turnDiffCompleted = (sequence: number, threadId: ThreadId, turnId: string) =>
  ({
    ...base(sequence, "thread.turn-diff-completed"),
    aggregateId: threadId,
    type: "thread.turn-diff-completed",
    payload: {
      threadId,
      turnId: TurnId.make(turnId),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/isnadi/checkpoints/turn-1"),
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: NOW,
    },
  }) satisfies OrchestrationEvent;

export const keepBusySet = (sequence: number, keepBusy: boolean) =>
  ({
    ...base(sequence, "group.keep-busy-set"),
    type: "group.keep-busy-set",
    payload: { groupId: GROUP_ID, keepBusy, updatedAt: NOW },
  }) satisfies OrchestrationEvent;

export const workItemCreated = (sequence: number, item: WorkItem) =>
  ({
    ...base(sequence, "work-item.created"),
    aggregateKind: "group" as const,
    aggregateId: GROUP_ID,
    type: "work-item.created",
    payload: { workItem: item },
  }) satisfies OrchestrationEvent;

export const harness = Effect.gen(function* () {
  const dispatched: OrchestrationCommand[] = [];

  // When set, every dispatch of that command type fails, as the engine does for a lost claim or a
  // refused turn start. Any dispatch error works, so a test can tell a refusal from a crash.
  const rejection = yield* Ref.make<
    { readonly type: string; readonly error: OrchestrationDispatchError } | undefined
  >(undefined);

  const events = yield* PubSub.unbounded<OrchestrationEvent>();

  // The dispatcher publishes its decision inline in the fiber that made it, so a plain Ref is
  // enough: by the time the reactor reports the queue drained, every receipt is in here.
  const receipts = yield* Ref.make<ReadonlyArray<OrchestrationRuntimeReceipt>>([]);

  const receiptBus = Layer.succeed(RuntimeReceiptBus, {
    publish: (receipt) => Ref.update(receipts, (all) => [...all, receipt]),
    streamEventsForTest: Stream.empty,
  });

  const engine: OrchestrationEngineService["Service"] = {
    readEvents: () => Stream.die("unused"),
    readThreadEvents: () => Stream.die("unused"),
    getThreadReplayStats: () => Effect.die("unused"),
    dispatch: (command) =>
      Ref.get(rejection).pipe(
        Effect.flatMap((reject) => {
          if (reject !== undefined && reject.type === command.type) {
            return Effect.fail(reject.error);
          }

          dispatched.push(command);

          return Effect.succeed({ sequence: dispatched.length });
        }),
      ),
    get streamDomainEvents() {
      return Stream.die("start should subscribe") as Stream.Stream<OrchestrationEvent>;
    },
    subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    latestSequence: Effect.succeed(0),
  };

  const activation = yield* Deferred.make<void>();
  yield* Deferred.succeed(activation, undefined);

  // The model the dispatcher reads. A test moves it forward between events, the way projecting
  // those events would.
  const model = yield* Ref.make<OrchestrationReadModel>(idleTeamModel());

  return { dispatched, rejection, events, engine, activation, model, receipts, receiptBus };
});

export const run = <A, E>(
  h: Effect.Success<typeof harness>,
  body: (context: {
    readonly reactor: FleetDispatcherReactor["Service"];
    readonly receipts: Effect.Effect<ReadonlyArray<OrchestrationRuntimeReceipt>>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const reactor = yield* FleetDispatcherReactor;

    yield* reactor.start();

    return yield* body({ reactor, receipts: Ref.getAndSet(h.receipts, []) });
  }).pipe(
    Effect.provideService(ServerActivation, Deferred.await(h.activation)),
    Effect.provide(
      FleetDispatcherReactorLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationEngineService, h.engine)),
        Layer.provide(
          // The dispatcher reads the command read model fresh on every decision.
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Ref.get(h.model),
          }),
        ),
        Layer.provide(h.receiptBus),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
