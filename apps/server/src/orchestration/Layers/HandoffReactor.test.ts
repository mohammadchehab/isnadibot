import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  BotId,
  EventId,
  HANDOFF_APPLIED_ACTIVITY_KIND,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  MessageId,
  ThreadId,
  TurnId,
} from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import { ServerActivation } from "../../serverActivation.ts";
import { refusedInvariantError } from "../Errors.ts";
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

const NOTE = EventId.make("handoff:1");

const handoffTurn = (
  input: Partial<ProjectionHandoffTurn> & Pick<ProjectionHandoffTurn, "sinceMessageId">,
): ProjectionHandoffTurn => ({
  activityId: NOTE,
  botId: BOT_ID,
  requested: true,
  ...input,
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

/** Runs one turn end through the reactor, so every test differs only in the turn it reports. */
const endTurn = (
  h: Harness,
  turn: Option.Option<ProjectionHandoffTurn>,
  status: "ready" | "error" = "ready",
) =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(turn);

    yield* run(h, ref, (reactor) =>
      Effect.gen(function* () {
        yield* PubSub.publish(h.events, sessionSet(1, THREAD, "running", TURN));
        yield* PubSub.publish(h.events, sessionSet(2, THREAD, status));
        yield* reactor.drainThrough(2);
      }),
    );
  }).pipe(Effect.scoped);

describe("HandoffReactor (TASK-84)", () => {
  it.effect("cuts a requested hand off at the message before the turn, and records it", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(h, Option.some(handoffTurn({ sinceMessageId: BEFORE_TURN })));

      expect(h.dispatched.map((command) => command.type)).toEqual([
        "thread.context.reset",
        "thread.activity.append",
      ]);
      expect(h.dispatched[0]).toMatchObject({
        commandId: "server:handoff:turn-handoff",
        threadId: THREAD,
        botId: BOT_ID,
        sinceMessageId: BEFORE_TURN,
        handoffActivityId: NOTE,
      });
      expect(h.dispatched[1]).toMatchObject({
        commandId: "server:handoff-applied:turn-handoff",
        threadId: THREAD,
        activity: {
          id: "handoff-applied:turn-handoff",
          kind: HANDOFF_APPLIED_ACTIVITY_KIND,
          turnId: TURN,
          payload: { botId: BOT_ID, turnId: TURN, handoffActivityId: NOTE },
        },
      });
    }),
  );

  it.effect("cuts a note the bot wrote on its own, with no row to undo", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(
        h,
        Option.some(handoffTurn({ sinceMessageId: BEFORE_TURN, requested: false })),
      );

      expect(h.dispatched.map((command) => command.type)).toEqual(["thread.context.reset"]);
    }),
  );

  it.effect("says the hand off did not happen when the turn errors, and resets nothing", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(h, Option.some(handoffTurn({ sinceMessageId: BEFORE_TURN })), "error");

      expect(h.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
      expect(h.dispatched[0]).toMatchObject({
        commandId: "server:handoff-not-applied:turn-handoff",
        threadId: THREAD,
        activity: {
          id: "handoff-not-applied:turn-handoff",
          kind: HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
          turnId: TURN,
          payload: { botId: BOT_ID, turnId: TURN, reason: "turn-not-completed" },
        },
      });
    }),
  );

  it.effect("says the hand off did not happen when a requested turn wrote no note", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(
        h,
        Option.some(handoffTurn({ sinceMessageId: BEFORE_TURN, activityId: null })),
      );

      expect(h.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
      expect(h.dispatched[0]).toMatchObject({
        activity: { payload: { botId: BOT_ID, turnId: TURN, reason: "no-note" } },
      });
    }),
  );

  it.effect("does nothing for a turn nobody asked to hand off that wrote no note", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(h, Option.none());

      expect(h.dispatched).toEqual([]);
    }),
  );

  it.effect("records the hand off of a chat the turn opened, without cutting anything", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* endTurn(h, Option.some(handoffTurn({ sinceMessageId: null })));

      expect(h.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
      expect(h.dispatched[0]).toMatchObject({
        activity: { kind: HANDOFF_APPLIED_ACTIVITY_KIND, turnId: TURN },
      });
    }),
  );

  it.effect("says nothing reset when the chat can no longer take the cut", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(h.rejection, {
        type: "thread.context.reset",
        error: refusedInvariantError({
          commandType: "thread.context.reset",
          detail: "Message 'message-before-turn' is not in chat 'thread-bot-specialist'.",
          refusal: "stale-view",
        }),
      });

      yield* endTurn(h, Option.some(handoffTurn({ sinceMessageId: BEFORE_TURN })));

      // The refused reset never reaches the recorded dispatches, so the one row
      // left is the chat's own account of what happened.
      expect(h.dispatched.map((command) => command.type)).toEqual(["thread.activity.append"]);
      expect(h.dispatched[0]).toMatchObject({
        activity: { payload: { botId: BOT_ID, turnId: TURN, reason: "reset-refused" } },
      });
    }),
  );
});
