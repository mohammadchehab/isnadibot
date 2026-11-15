import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  BotId,
  DelegationId,
  ThreadId,
  TurnId,
  type IsnadiDelegationRecord,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import { ServerActivation } from "../../serverActivation.ts";
import { DelegationWakeReactor } from "../Services/DelegationWakeReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { DelegationWakeReactorLive } from "./DelegationWakeReactor.ts";
import {
  NOW,
  base,
  botThread,
  harness,
  sessionSet,
} from "../test-support/FleetDispatcherFixtures.ts";
import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";

const BOSS_ID = BotId.make("bot-boss");

const BOSS_THREAD = ThreadId.make("thread-boss");

const CHILD_THREAD = ThreadId.make("thread-child");

const CHILD_TURN = TurnId.make("turn-child");

const delegation = (
  id: string,
  phase: "running" | "completed" | "completed-acknowledged",
): IsnadiDelegationRecord => {
  const finished = {
    childThreadId: CHILD_THREAD,
    childTurnId: CHILD_TURN,
    startedAt: NOW,
    completedAt: NOW,
  } as const;

  return {
    delegationId: DelegationId.make(id),
    parentDelegationId: null,
    parentBotId: BOSS_ID,
    childBotId: SPECIALIST_ID,
    parentThreadId: BOSS_THREAD,
    parentTurnId: TurnId.make("turn-boss"),
    ancestorBotIds: [BOSS_ID],
    depth: 1,
    task: "Build the list view.",
    expectedResult: "A working list view.",
    deadline: null,
    access: {
      allowedToolIds: [],
      memoryScopes: [],
      sandbox: "local",
      runtimeMode: "approval-required",
      hasUserComputer: false,
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
      approvalCeiling: "send",
    },
    billedBotId: SPECIALIST_ID,
    keep: false,
    anchorMessageId: null,
    retryOfDelegationId: null,
    trigger: "bot",
    createdAt: NOW,
    updatedAt: NOW,
    phase:
      phase === "running"
        ? {
            _tag: "Running",
            childThreadId: CHILD_THREAD,
            childTurnId: CHILD_TURN,
            startedAt: NOW,
            progress: null,
          }
        : {
            _tag: "Completed",
            ...finished,
            acknowledgedAt: phase === "completed" ? null : NOW,
            result: { summary: "Done.", childThreadId: CHILD_THREAD, childTurnId: CHILD_TURN },
          },
  };
};

const delegationUpdated = (sequence: number, record: IsnadiDelegationRecord) =>
  ({
    ...base(sequence, "delegation.updated"),
    aggregateId: BOSS_THREAD,
    type: "delegation.updated",
    payload: { delegation: record },
  }) satisfies OrchestrationEvent;

const model = (
  delegations: ReadonlyArray<IsnadiDelegationRecord>,
  bossSession: "idle" | "running" = "idle",
): OrchestrationReadModel => {
  const boss = botThread(BOSS_ID, BOSS_THREAD);

  return {
    ...makeReadModel({
      bots: [makeBot({ id: BOSS_ID, groupId: GROUP_ID }), makeBot({ id: SPECIALIST_ID })],
      groups: [makeGroup({ id: GROUP_ID, bossBotId: BOSS_ID })],
      threads: [
        bossSession === "idle"
          ? boss
          : {
              ...boss,
              session: {
                threadId: BOSS_THREAD,
                status: "running",
                providerName: "codex",
                runtimeMode: "full-access",
                activeTurnId: TurnId.make("turn-boss-live"),
                lastError: null,
                updatedAt: NOW,
              },
            },
      ],
    }),
    delegations: [...delegations],
  };
};

const run = <A, E>(
  h: Effect.Success<typeof harness>,
  body: (reactor: DelegationWakeReactor["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const reactor = yield* DelegationWakeReactor;
    yield* reactor.start();

    return yield* body(reactor);
  }).pipe(
    Effect.provideService(ServerActivation, Deferred.await(h.activation)),
    Effect.provide(
      DelegationWakeReactorLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationEngineService, h.engine)),
        Layer.provide(
          Layer.mock(ProjectionSnapshotQuery)({ getCommandReadModel: () => Ref.get(h.model) }),
        ),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

describe("DelegationWakeReactor (TASK-362)", () => {
  it.effect("wakes the idle boss once its last open delegation completes", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* run(h, (reactor) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          const done = [delegation("d-1", "completed"), delegation("d-2", "completed")];
          yield* Ref.set(h.model, model(done));
          yield* PubSub.publish(h.events, delegationUpdated(1, done[1]!));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual(["thread.turn.start"]);
          expect(h.dispatched[0]).toMatchObject({
            threadId: BOSS_THREAD,
            trigger: { kind: "delegation-results" },
          });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("holds the wake while another delegation is still open", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* run(h, (reactor) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          const mixed = [delegation("d-1", "completed"), delegation("d-2", "running")];
          yield* Ref.set(h.model, model(mixed));
          yield* PubSub.publish(h.events, delegationUpdated(1, mixed[0]!));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("waits for a live boss turn to end, then wakes it", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* run(h, (reactor) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          const done = [delegation("d-1", "completed")];
          yield* Ref.set(h.model, model(done, "running"));
          yield* PubSub.publish(h.events, delegationUpdated(1, done[0]!));
          yield* reactor.drainThrough(1);
          expect(h.dispatched).toEqual([]);

          yield* Ref.set(h.model, model(done));
          yield* PubSub.publish(h.events, sessionSet(2, BOSS_THREAD, "ready"));
          yield* reactor.drainThrough(2);
          expect(h.dispatched.map((command) => command.type)).toEqual(["thread.turn.start"]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not wake a boss whose results are already acknowledged", () =>
    Effect.gen(function* () {
      const h = yield* harness;
      yield* run(h, (reactor) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          const seen = [delegation("d-1", "completed-acknowledged")];
          yield* Ref.set(h.model, model(seen));
          yield* PubSub.publish(h.events, sessionSet(1, BOSS_THREAD, "ready"));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );
});
