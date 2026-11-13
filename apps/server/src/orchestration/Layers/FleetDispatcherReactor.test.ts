import { it } from "@effect/vitest";
import {
  BotId,
  CheckpointRef,
  EventId,
  FleetRoleId,
  ThreadId,
  TurnId,
  WorkItemId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationBot,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkItem,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ServerActivation } from "../../serverActivation.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { FleetDispatcherReactor } from "../Services/FleetDispatcherReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import {
  BOSS_ID,
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import { FleetDispatcherReactorLive } from "./FleetDispatcherReactor.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const LATER = "2026-01-01T00:00:05.000Z";

const LATEST = "2026-01-01T00:00:10.000Z";

const BOT_THREAD = ThreadId.make("thread-bot-specialist");

/** Two specialists whose ids sort in the order the pick uses, spelled out to keep it obvious. */
const BOT_A = makeBot({ id: "bot-a" as BotId, groupId: GROUP_ID });

const BOT_B = makeBot({ id: "bot-b" as BotId, groupId: GROUP_ID });

/** A team hired into roles, so an item that names a role has someone it could go to. */
const ARCHITECT_ID = BotId.make("bot-architect");

const ENGINEER_ID = BotId.make("bot-engineer");

const ARCHITECT_ROLE = FleetRoleId.make("architect");

const TEAM = [
  makeBot({ id: ARCHITECT_ID, groupId: GROUP_ID, roleId: ARCHITECT_ROLE }),
  makeBot({ id: ENGINEER_ID, groupId: GROUP_ID, roleId: FleetRoleId.make("engineer") }),
];

/**
 * A keep-busy group of role-bearing specialists: `busy` may name a member whose turn is still
 * running, so the role it holds is taken but the bot itself is not free.
 */
const roleTeamModel = (input: {
  readonly bots: ReadonlyArray<OrchestrationBot>;
  readonly busy?: ReadonlyArray<BotId>;
  readonly items: ReadonlyArray<WorkItem>;
}): OrchestrationReadModel => {
  const busy = new Set(input.busy ?? []);

  return {
    ...makeReadModel({
      bots: input.bots,
      groups: [
        keepBusyGroup({
          bossBotId: null,
          members: input.bots.map((bot) => ({
            kind: "bot" as const,
            botId: bot.id,
            role: "specialist" as const,
          })),
        }),
      ],
      threads: input.bots.map((bot) =>
        busy.has(bot.id)
          ? runningThread(bot.id, `thread-${bot.id}`)
          : botThread(bot.id, `thread-${bot.id}`),
      ),
    }),
    workItems: input.items,
  };
};

const botThread = (botId: BotId, id: string): OrchestrationThread => ({
  ...makeGroupThread(),
  id: ThreadId.make(id),
  botId,
  groupId: null,
  session: null,
  latestTurn: null,
});

/** A bot with a turn still running: it is not idle and cannot take anything. */
const runningThread = (botId: BotId, id: string): OrchestrationThread => ({
  ...botThread(botId, id),
  session: {
    threadId: ThreadId.make(id),
    status: "running",
    providerName: "codex",
    runtimeMode: "full-access",
    activeTurnId: TurnId.make("turn-1"),
    lastError: null,
    updatedAt: NOW,
  },
});

const workItem = (input: {
  readonly id: string;
  readonly state?: WorkItem["state"];
  readonly ownerBotId?: BotId;
  readonly role?: WorkItem["role"];
  readonly createdAt?: string;
}): WorkItem => ({
  id: WorkItemId.make(input.id),
  groupId: GROUP_ID,
  title: `Item ${input.id}`,
  brief: "Fix the thing.",
  kind: "task",
  state: input.state ?? "queued",
  ...(input.ownerBotId === undefined ? {} : { ownerBotId: input.ownerBotId }),
  ...(input.role === undefined ? {} : { role: input.role }),
  createdAt: input.createdAt ?? NOW,
  updatedAt: NOW,
});

const keepBusyGroup = (
  input: {
    readonly bossBotId?: OrchestrationGroup["bossBotId"];
    readonly members?: OrchestrationGroup["members"];
  } = {},
): OrchestrationGroup => ({ ...makeGroup(input), keepBusy: true });

/** One idle specialist in a keep-busy group, with its own chat and nothing queued. */
const idleTeamModel = (items: ReadonlyArray<WorkItem> = []): OrchestrationReadModel => ({
  ...makeReadModel({
    bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
    groups: [keepBusyGroup()],
    threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
  }),
  workItems: items,
});

const base = (sequence: number, eventType: string) => ({
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

const sessionSet = (
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
const turnDiffCompleted = (sequence: number, threadId: ThreadId, turnId: string) =>
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

const keepBusySet = (sequence: number, keepBusy: boolean) =>
  ({
    ...base(sequence, "group.keep-busy-set"),
    type: "group.keep-busy-set",
    payload: { groupId: GROUP_ID, keepBusy, updatedAt: NOW },
  }) satisfies OrchestrationEvent;

const workItemCreated = (sequence: number, item: WorkItem) =>
  ({
    ...base(sequence, "work-item.created"),
    aggregateKind: "group" as const,
    aggregateId: GROUP_ID,
    type: "work-item.created",
    payload: { workItem: item },
  }) satisfies OrchestrationEvent;

const harness = Effect.gen(function* () {
  const dispatched: OrchestrationCommand[] = [];

  // When set, every dispatch of that command type fails, as the engine does for a lost claim.
  const rejection = yield* Ref.make<
    { readonly type: string; readonly error: OrchestrationCommandInvariantError } | undefined
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

const run = <A, E>(
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

describe("FleetDispatcherReactor", () => {
  it.effect("hands the queued item to the idle specialist when a turn ends", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          // Nothing queued yet, so the restore at start has nothing to hand out. It says so once;
          // that receipt is the restore's, not the turn end's, so drop it before the real check.
          yield* reactor.drain;
          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([{ kind: "skipped", reason: "queue-empty" }]);

          yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "running"));
          yield* PubSub.publish(h.events, sessionSet(2, BOT_THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({
            botId: SPECIALIST_ID,
            workItemId: "item-1",
          });
          expect(h.dispatched[1]).toMatchObject({
            threadId: BOT_THREAD,
            runtimeMode: "full-access",
            message: {
              role: "user",
              text: "Item item-1\n\nFix the thing.",
            },
          });

          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "assigned",
              itemId: "item-1",
              botId: SPECIALIST_ID,
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("dispatches a newly queued item without waiting for a turn to end", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          const item = workItem({ id: "item-1" });

          yield* Ref.update(h.model, (model) => ({ ...model, workItems: [item] }));
          yield* PubSub.publish(h.events, workItemCreated(1, item));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a group that is not kept busy alone", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* Ref.set(h.model, {
            ...idleTeamModel([workItem({ id: "item-1" })]),
            groups: [makeGroup()],
          });
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "running"));
          yield* PubSub.publish(h.events, sessionSet(2, BOT_THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("dispatches a queue left waiting by a restart, with no turn to end", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("stops when another dispatcher won the claim, and starts no turn", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(h.rejection, {
        type: "work-item.claim",
        error: new OrchestrationCommandInvariantError({
          commandType: "work-item.claim",
          detail: "Work item 'item-1' is no longer queued.",
        }),
      });
      yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.filter((command) => command.type === "thread.turn.start")).toEqual(
            [],
          );
          expect(yield* receipts).toMatchObject([
            { type: "fleet.dispatch.decided", kind: "skipped", reason: "claim-lost" },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("hands one item to one of two idle specialists, the lowest id", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const members = [
        { kind: "bot" as const, botId: BOSS_ID, role: "boss" as const },
        { kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const },
        { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
      ];

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [makeBot({ id: BOSS_ID, groupId: GROUP_ID }), BOT_A, BOT_B],
          groups: [keepBusyGroup({ members })],
          threads: [
            botThread(BOT_A.id, "thread-a"),
            botThread(BOT_B.id, "thread-b"),
            botThread(BOSS_ID, "thread-boss"),
          ],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          // The boss works only when it is the group's only bot.
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id });
          expect(h.dispatched[1]).toMatchObject({ threadId: ThreadId.make("thread-a") });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("hands out one item per idle member, oldest first", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const members = [
        { kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const },
        { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
      ];

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [BOT_A, BOT_B],
          groups: [keepBusyGroup({ bossBotId: null, members })],
          threads: [botThread(BOT_A.id, "thread-a"), botThread(BOT_B.id, "thread-b")],
        }),
        workItems: [
          workItem({ id: "item-newer", createdAt: LATER }),
          workItem({ id: "item-older", createdAt: NOW }),
          // A third item waits for the next sweep: only two members are free.
          workItem({ id: "item-last", createdAt: LATEST }),
        ],
      });

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id, workItemId: "item-older" });
          expect(h.dispatched[2]).toMatchObject({ botId: BOT_B.id, workItemId: "item-newer" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("reports an empty queue instead of starting a turn", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The restore sweep's own queue-empty receipt, consumed so the switch is what is left.
          expect(yield* receipts).toMatchObject([{ kind: "skipped", reason: "queue-empty" }]);

          yield* PubSub.publish(h.events, keepBusySet(1, true));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            { type: "fleet.dispatch.decided", kind: "skipped", reason: "queue-empty" },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("reports a member with no chat instead of starting a turn it cannot start", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The group has an idle member, but the bot never opened a chat.
      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
          groups: [keepBusyGroup()],
          threads: [],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.filter((command) => command.type === "thread.turn.start")).toEqual(
            [],
          );
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "no-chat",
              botId: SPECIALIST_ID,
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a bot alone while a turn of its own is still running", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const busyThread: OrchestrationThread = {
        ...botThread(SPECIALIST_ID, "thread-bot-specialist"),
        session: {
          threadId: BOT_THREAD,
          status: "running",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: TurnId.make("turn-1"),
          lastError: null,
          updatedAt: NOW,
        },
      };

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
          groups: [keepBusyGroup()],
          threads: [busyThread],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "no-idle-member",
              itemId: "item-1",
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a bot alone while it owns a work item it has not finished", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        idleTeamModel([
          workItem({ id: "item-held", state: "in-progress", ownerBotId: SPECIALIST_ID }),
          workItem({ id: "item-queued" }),
        ]),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("acts once on a turn end that arrives as a diff and again as a session stop", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));
          yield* PubSub.publish(
            h.events,
            sessionSet(1, BOT_THREAD, "running", TurnId.make("turn-1")),
          );
          yield* PubSub.publish(h.events, turnDiffCompleted(2, BOT_THREAD, "turn-1"));
          yield* PubSub.publish(h.events, sessionSet(3, BOT_THREAD, "ready"));
          yield* reactor.drainThrough(3);

          // The claim and the turn it started, not a second pair for the repeated turn end.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(
            h.dispatched.flatMap((command) =>
              command.type === "thread.turn.start" ? [command.message.messageId] : [],
            ),
          ).toHaveLength(1);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("takes a chat's own provider by the lowest id, and ignores an archived bot", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID, archivedAt: NOW })],
          groups: [keepBusyGroup()],
          threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            { type: "fleet.dispatch.decided", kind: "skipped", reason: "no-idle-member" },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("keeps an item queued while the only member holding its role is busy", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        roleTeamModel({
          bots: TEAM,
          busy: [ARCHITECT_ID],
          items: [workItem({ id: "item-design", role: ARCHITECT_ROLE })],
        }),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The engineer is free, but the item asked for the architect and the architect is not.
          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "role-holder-busy",
              itemId: "item-design",
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("hands a role-bearing item to the idle member that holds its role", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        roleTeamModel({
          bots: TEAM,
          items: [workItem({ id: "item-design", role: ARCHITECT_ROLE })],
        }),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          // The engineer sorts higher by id, but the item named the architect's role.
          expect(h.dispatched[0]).toMatchObject({
            botId: ARCHITECT_ID,
            workItemId: "item-design",
          });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("hands an item whose role nobody holds to any idle specialist", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        roleTeamModel({
          bots: TEAM,
          items: [workItem({ id: "item-report", role: FleetRoleId.make("writer") })],
        }),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: ARCHITECT_ID });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("dispatches past a role-blocked item instead of ending the group's pass", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        roleTeamModel({
          bots: TEAM,
          busy: [ARCHITECT_ID],
          items: [
            workItem({ id: "item-design", role: ARCHITECT_ROLE, createdAt: NOW }),
            workItem({ id: "item-fix", createdAt: LATER }),
          ],
        }),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The design item waits for its architect; the role-less one behind it still goes out.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({
            botId: ENGINEER_ID,
            workItemId: "item-fix",
          });
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "role-holder-busy",
              itemId: "item-design",
            },
            {
              type: "fleet.dispatch.decided",
              kind: "assigned",
              itemId: "item-fix",
              botId: ENGINEER_ID,
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a second item for the same role queued once that member is busied", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        roleTeamModel({
          bots: TEAM,
          items: [
            workItem({ id: "item-design-1", role: ARCHITECT_ROLE, createdAt: NOW }),
            workItem({ id: "item-design-2", role: ARCHITECT_ROLE, createdAt: LATER }),
          ],
        }),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // One architect, one item: the second waits for it rather than falling to the engineer.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({
            botId: ARCHITECT_ID,
            workItemId: "item-design-1",
          });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("lets the boss that is the group's only bot take a role-bearing item", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const boss = makeBot({ id: BOSS_ID, groupId: GROUP_ID, roleId: ARCHITECT_ROLE });

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [boss],
          groups: [keepBusyGroup({ members: [{ kind: "bot", botId: BOSS_ID, role: "boss" }] })],
          threads: [botThread(BOSS_ID, "thread-boss")],
        }),
        workItems: [workItem({ id: "item-design", role: ARCHITECT_ROLE })],
      });

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOSS_ID });
        }),
      );
    }).pipe(Effect.scoped),
  );
});
