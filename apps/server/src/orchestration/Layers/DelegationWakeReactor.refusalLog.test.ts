import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  BotId,
  DelegationId,
  ThreadId,
  TurnId,
  type IsnadiDelegationRecord,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import { describe, expect } from "vite-plus/test";

import { ServerActivation } from "../../serverActivation.ts";
import {
  internalInvariantError,
  refusedInvariantError,
  type OrchestrationCommandInvariantError,
} from "../Errors.ts";
import { DelegationWakeReactor } from "../Services/DelegationWakeReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { DelegationWakeReactorLive } from "./DelegationWakeReactor.ts";
import { makeDelegation } from "../test-support/DelegationDeciderFixtures.ts";
import { NOW, botThread, harness } from "../test-support/FleetDispatcherFixtures.ts";
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

const REFUSAL_LINE = "delegation wake was refused";

/** A log line this reactor wrote, as the logger received it. */
interface CapturedLine {
  readonly level: string;
  readonly message: ReadonlyArray<unknown>;
}

/** Every line the reactor wrote about a refused wake, whatever level it chose. */
const refusalLines = (lines: ReadonlyArray<CapturedLine>) =>
  lines.filter((line) => line.message[0] === REFUSAL_LINE);

/**
 * A completed delegation whose results the boss has not acknowledged, so the reactor owes it a
 * wake. The fixtures' own parent and child are replaced: this reactor's boss is the thread it
 * sweeps, not the delegation decider's.
 */
const completedDelegation = (id: string): IsnadiDelegationRecord =>
  makeDelegation({
    delegationId: DelegationId.make(id),
    parentBotId: BOSS_ID,
    parentThreadId: BOSS_THREAD,
    childBotId: SPECIALIST_ID,
    ancestorBotIds: [BOSS_ID],
    billedBotId: SPECIALIST_ID,
    phase: {
      _tag: "Completed",
      childThreadId: CHILD_THREAD,
      childTurnId: CHILD_TURN,
      startedAt: NOW,
      completedAt: NOW,
      acknowledgedAt: null,
      result: { summary: "Done.", childThreadId: CHILD_THREAD, childTurnId: CHILD_TURN },
    },
  });

/**
 * The boss sits in `ready`, which is not a live session, so the reactor owes it the wake and the
 * line has a real session status to report rather than the absent one.
 */
const model = (delegations: ReadonlyArray<IsnadiDelegationRecord>): OrchestrationReadModel => ({
  ...makeReadModel({
    bots: [makeBot({ id: BOSS_ID, groupId: GROUP_ID }), makeBot({ id: SPECIALIST_ID })],
    groups: [makeGroup({ id: GROUP_ID, bossBotId: BOSS_ID })],
    threads: [
      {
        ...botThread(BOSS_ID, BOSS_THREAD),
        session: {
          threadId: BOSS_THREAD,
          status: "ready",
          providerName: "codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      },
    ],
  }),
  delegations: [...delegations],
});

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

/** Runs a sweep with a logger in place, so a test can read what the reactor said. */
const capture = <A, E, R>(body: Effect.Effect<A, E, R>, minimumLevel: "Info" | "Debug" = "Info") =>
  Effect.gen(function* () {
    const lines: Array<CapturedLine> = [];

    const logger = Logger.make(({ logLevel, message }) => {
      if (!Array.isArray(message)) return;

      lines.push({ level: logLevel, message });
    });

    const result = yield* body.pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      Effect.provideService(References.MinimumLogLevel, minimumLevel),
    );

    return { result, lines };
  });

/** A wake the decider refuses for the given reason, as the engine hands it back. */
const refusingWake = (error: OrchestrationCommandInvariantError) => ({
  type: "thread.turn.start",
  error,
});

/**
 * A refused wake becomes no event, no receipt and no counter, so this line is the only thing that
 * tells an operator a wake was owed and refused — and the code in it is the only thing that tells
 * a benign lifecycle no-op from an authorization refusal (TASK-400).
 */
describe("DelegationWakeReactor refusal log (TASK-400)", () => {
  it.effect("names the invariant code, the delegation and the boss session of a refused wake", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* Ref.set(h.model, model([completedDelegation("d-1")]));
        // An authorization refusal: the reason the card exists. It arrives through the same catch
        // as an archived bot, so nothing but the code can tell them apart.
        yield* Ref.set(
          h.rejection,
          refusingWake(
            refusedInvariantError({
              commandType: "thread.turn.start",
              detail: "Bot 'bot-boss' is not a member of the group.",
              refusal: "actor-not-a-group-member",
            }),
          ),
        );

        const { lines } = yield* capture(run(h, (reactor) => reactor.drain));

        expect(h.dispatched).toEqual([]);

        expect(refusalLines(lines)).toEqual([
          {
            level: "Info",
            message: [
              REFUSAL_LINE,
              expect.objectContaining({
                threadId: BOSS_THREAD,
                delegationIds: [DelegationId.make("d-1")],
                bossSessionStatus: "ready",
                commandType: "thread.turn.start",
                failure: { _tag: "refused", refusal: "actor-not-a-group-member" },
              }),
            ],
          },
        ]);
      }),
    ),
  );

  // The catch is on the whole invariant class, so a throw with no refusal code must still say
  // which arm it was: `excluded` is a server bug, and reading it as "no wake was owed" would hide
  // one.
  it.effect("names the arm of a throw that carries no refusal code", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* Ref.set(h.model, model([completedDelegation("d-1")]));
        yield* Ref.set(
          h.rejection,
          refusingWake(
            internalInvariantError({
              commandType: "thread.turn.start",
              detail: "The boss chat is archived.",
              reason: "Test fixture: the decider refuses a turn start on an archived chat.",
            }),
          ),
        );

        const { lines } = yield* capture(run(h, (reactor) => reactor.drain));

        expect(refusalLines(lines)).toEqual([
          {
            level: "Info",
            message: [
              REFUSAL_LINE,
              expect.objectContaining({
                threadId: BOSS_THREAD,
                failure: {
                  _tag: "excluded",
                  exclusion: {
                    kind: "internal-command",
                    reason: "Test fixture: the decider refuses a turn start on an archived chat.",
                  },
                },
              }),
            ],
          },
        ]);
      }),
    ),
  );

  // The other half: a wake that lands says nothing here, so the line means a refusal and not
  // every sweep.
  it.effect("says nothing when the wake is accepted", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness;
        yield* Ref.set(h.model, model([completedDelegation("d-1")]));

        const { lines } = yield* capture(run(h, (reactor) => reactor.drain));

        expect(h.dispatched.map((command) => command.type)).toEqual(["thread.turn.start"]);
        expect(refusalLines(lines)).toEqual([]);
      }),
    ),
  );
});
