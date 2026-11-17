import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  BotId,
  EventId,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  MessageId,
  ThreadId,
  TurnId,
  type HandoffDoc,
} from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import { ServerActivation } from "../../serverActivation.ts";
import { HandoffReactor } from "../Services/HandoffReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionHandoffTurn,
} from "../Services/ProjectionSnapshotQuery.ts";
import { harness, sessionSet } from "../test-support/FleetDispatcherFixtures.ts";
import { HandoffReactorLive } from "./HandoffReactor.ts";

const BOT_ID = BotId.make("bot-specialist");

const THREAD = ThreadId.make("thread-bot-specialist");

const TURN = TurnId.make("turn-handoff");

const BEFORE_TURN = MessageId.make("message-before-turn");

const DOC: HandoffDoc = {
  item: "Ship the handoff engine.",
  branch: "feature/task-84-handoff-engine",
  done: "The reactor dispatches the cut.",
  nextStep: "Write the tests.",
  waitingOn: "",
  doNot: "Do not merge.",
};

const handoffTurn = (sinceMessageId: MessageId | null): ProjectionHandoffTurn => ({
  activityId: EventId.make("handoff:1"),
  botId: BOT_ID,
  doc: DOC,
  sinceMessageId,
});

type Harness = Effect.Success<typeof harness>;

const run = <A, E>(
  h: Harness,
  turn: Ref.Ref<Option.Option<ProjectionHandoffTurn>>,
  body: (reactor: HandoffReactor["Service"]) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const reactor = yield* HandoffReactor;

    yield* reactor.start();

    return yield* body(reactor);
  }).pipe(
    Effect.provideService(ServerActivation, Deferred.await(h.activation)),
    Effect.provide(
      HandoffReactorLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationEngineService, h.engine)),
        Layer.provide(
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Ref.get(h.model),
            getHandoffTurn: () => Ref.get(turn),
          }),
        ),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );

describe("HandoffReactor (TASK-84)", () => {
  it.effect("cuts the bot's context at the message before a completed handoff turn", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const turn = yield* Ref.make<Option.Option<ProjectionHandoffTurn>>(
        Option.some(handoffTurn(BEFORE_TURN)),
      );

      yield* run(h, turn, (reactor) =>
        Effect.gen(function* () {
          yield* PubSub.publish(h.events, sessionSet(1, THREAD, "running", TURN));
          yield* PubSub.publish(h.events, sessionSet(2, THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched.map((command) => command.type)).toEqual(["thread.context.reset"]);
          expect(h.dispatched[0]).toMatchObject({
            commandId: "server:handoff:turn-handoff",
            threadId: THREAD,
            botId: BOT_ID,
            sinceMessageId: BEFORE_TURN,
            handoffActivityId: "handoff:1",
          });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("says the hand off did not happen when the turn errors, and resets nothing", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const turn = yield* Ref.make<Option.Option<ProjectionHandoffTurn>>(
        Option.some(handoffTurn(BEFORE_TURN)),
      );

      yield* run(h, turn, (reactor) =>
        Effect.gen(function* () {
          yield* PubSub.publish(h.events, sessionSet(1, THREAD, "running", TURN));
          yield* PubSub.publish(h.events, sessionSet(2, THREAD, "error"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
          expect(h.dispatched[0]).toMatchObject({
            commandId: "server:handoff-not-applied:turn-handoff",
            threadId: THREAD,
            activity: {
              id: "handoff-not-applied:turn-handoff",
              kind: HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
              turnId: TURN,
              payload: { turnId: TURN, state: "error" },
            },
          });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does nothing for a turn that wrote no note", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const turn = yield* Ref.make<Option.Option<ProjectionHandoffTurn>>(Option.none());

      yield* run(h, turn, (reactor) =>
        Effect.gen(function* () {
          yield* PubSub.publish(h.events, sessionSet(1, THREAD, "running", TURN));
          yield* PubSub.publish(h.events, sessionSet(2, THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not cut a chat the handoff turn opened", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const turn = yield* Ref.make<Option.Option<ProjectionHandoffTurn>>(
        Option.some(handoffTurn(null)),
      );

      yield* run(h, turn, (reactor) =>
        Effect.gen(function* () {
          yield* PubSub.publish(h.events, sessionSet(1, THREAD, "running", TURN));
          yield* PubSub.publish(h.events, sessionSet(2, THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );
});
