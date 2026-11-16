import { it } from "@effect/vitest";
import type {
  BotId,
  OrchestrationReadModel,
  OrchestrationThread,
  WorkItem,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Struct from "effect/Struct";
import { TestClock } from "effect/testing";
import { describe, expect } from "vite-plus/test";

import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  BOT_THREAD,
  NOW,
  type OnCommand,
  crashedDispatcherTurn,
  failedDispatcherTurn,
  harness,
  interruptedDispatcherTurn,
  keepBusyGroup,
  keepBusySet,
  liveDispatcherTurn,
  run,
  sessionSet,
  workItem,
} from "../test-support/FleetDispatcherFixtures.ts";
import { DISPATCH_RETRY_DELAY } from "./FleetDispatcherReactor.ts";

/** One keep-busy group whose only member holds an item, and the chat its dispatcher turn ran in. */
const teamModel = (input: {
  readonly turnThread: OrchestrationThread;
  readonly item: WorkItem;
}): OrchestrationReadModel => ({
  ...makeReadModel({
    bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
    groups: [keepBusyGroup()],
    threads: [input.turnThread],
  }),
  workItems: [input.item],
});

/**
 * The item after the command the reactor dispatched, as the decider would leave it. The fake
 * engine does not project, so without this the next pass reads the item as still assigned and the
 * requeue it just caused is invisible. Only the two transitions this card adds are modelled.
 */
const afterReap = (
  item: WorkItem,
  command: { readonly botId: BotId; readonly cause: "interrupted" | "dead" },
): WorkItem => {
  const attempts = item.attempts ?? 0;

  // A second consecutive death blocks: the owner stays on the item, and the reason with it.
  if (command.cause === "dead" && attempts >= 1)
    return {
      ...item,
      state: "blocked",
      blockedFrom: "assigned",
      blockedOn: { by: "bot", botId: command.botId, note: "Two dispatcher turns failed in a row." },
      attempts: attempts + 1,
      updatedAt: NOW,
    };

  // A requeue releases the owner so the item is the group's again; an interrupt counts nothing.
  return {
    ...Struct.omit(item, ["ownerBotId"]),
    state: "queued",
    attempts: command.cause === "dead" ? attempts + 1 : attempts,
    updatedAt: NOW,
  };
};

/** Stands in for the projector: moves the read model on for the one command this card adds. */
const projectReaps =
  (model: Ref.Ref<OrchestrationReadModel>): OnCommand =>
  (command, outcome) =>
    outcome === "rejected" || command.type !== "work-item.dispatcher-failed"
      ? Effect.void
      : Ref.update(model, (current) => ({
          ...current,
          workItems: (current.workItems ?? []).map((item) =>
            item.id === command.workItemId ? afterReap(item, command) : item,
          ),
        }));

describe("FleetDispatcherReactor dead dispatcher turns (TASK-240)", () => {
  it.effect("requeues an item whose dispatcher turn died and holds it for one retry delay", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          // The restore pass's own receipt, consumed so what follows is this test's.
          yield* reactor.drain;
          yield* receipts;

          yield* Ref.set(
            h.model,
            teamModel({
              turnThread: failedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
              item: workItem({ id: "item-1", state: "assigned", ownerBotId: SPECIALIST_ID }),
            }),
          );
          yield* Ref.set(h.onCommand, projectReaps(h.model));

          // The provider's turn ends in error: the session leaves "running" with nothing active.
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "error"));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.dispatcher-failed",
          ]);
          expect(h.dispatched[0]).toMatchObject({
            botId: SPECIALIST_ID,
            workItemId: "item-1",
            threadId: BOT_THREAD,
            turnId: "turn-item-1",
            cause: "dead",
            detail: "provider exited",
          });

          // Back in the queue, but the pass that put it there does not hand it straight back.
          expect(yield* receipts).toContainEqual(
            expect.objectContaining({
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "retry-pending",
            }),
          );

          // One breath later the retry fires on its own and the item is handed out.
          yield* Effect.yieldNow;
          yield* TestClock.adjust(DISPATCH_RETRY_DELAY);
          yield* Effect.yieldNow;
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.dispatcher-failed",
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[1]).toMatchObject({ botId: SPECIALIST_ID, workItemId: "item-1" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("blocks on a second consecutive death and arms no retry", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          yield* receipts;

          yield* Ref.set(
            h.model,
            teamModel({
              turnThread: failedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
              item: workItem({
                id: "item-1",
                state: "assigned",
                ownerBotId: SPECIALIST_ID,
                attempts: 1,
              }),
            }),
          );
          yield* Ref.set(h.onCommand, projectReaps(h.model));

          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "error"));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.dispatcher-failed",
          ]);
          expect(h.dispatched[0]).toMatchObject({ cause: "dead", detail: "provider exited" });

          // The block is the decider's (see decider.workItemDispatcherFailed.test.ts). What the
          // reactor owns is that a second death arms nothing, so the clock moving on wakes nothing.
          yield* Effect.yieldNow;
          yield* TestClock.adjust(DISPATCH_RETRY_DELAY);
          yield* Effect.yieldNow;
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.dispatcher-failed",
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("hands an interrupted item straight back without a delay or a counted failure", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          yield* receipts;

          yield* Ref.set(
            h.model,
            teamModel({
              turnThread: interruptedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
              item: workItem({ id: "item-1", state: "assigned", ownerBotId: SPECIALIST_ID }),
            }),
          );
          yield* Ref.set(h.onCommand, projectReaps(h.model));

          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "ready"));
          yield* reactor.drainThrough(1);

          // No clock adjust anywhere: a person taking the bot back costs no delay.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.dispatcher-failed",
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ cause: "interrupted", turnId: "turn-item-1" });
          expect(yield* receipts).not.toContainEqual(
            expect.objectContaining({ kind: "skipped", reason: "retry-pending" }),
          );
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect(
    "reaps a turn whose provider vanished on the start sweep, with no event to wake it",
    () =>
      Effect.gen(function* () {
        const h = yield* harness;

        yield* Ref.set(
          h.model,
          teamModel({
            turnThread: crashedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
            item: workItem({ id: "item-1", state: "assigned", ownerBotId: SPECIALIST_ID }),
          }),
        );

        yield* run(h, ({ reactor }) =>
          Effect.gen(function* () {
            // Nothing is published: a restart is the case the sweep exists for.
            yield* reactor.drain;

            expect(h.dispatched.map((command) => command.type)).toEqual([
              "work-item.dispatcher-failed",
            ]);
            expect(h.dispatched[0]).toMatchObject({
              workItemId: "item-1",
              threadId: BOT_THREAD,
              cause: "dead",
            });
          }),
        );
      }).pipe(Effect.scoped),
  );

  it.effect("reports one dead turn once however often the group is decided", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        teamModel({
          turnThread: failedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
          item: workItem({ id: "item-1", state: "assigned", ownerBotId: SPECIALIST_ID }),
        }),
      );

      // No projector here on purpose: the read model keeps saying the item is assigned, so only
      // the reactor's own record of the reaped turn stops a second report of the same death.
      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* PubSub.publish(h.events, keepBusySet(1, true));
          yield* reactor.drainThrough(1);

          yield* PubSub.publish(h.events, sessionSet(2, BOT_THREAD, "error"));
          yield* reactor.drainThrough(2);

          expect(
            h.dispatched.filter((command) => command.type === "work-item.dispatcher-failed"),
          ).toHaveLength(1);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("leaves a turn that is still running with a live session alone", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        teamModel({
          turnThread: liveDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
          item: workItem({ id: "item-1", state: "assigned", ownerBotId: SPECIALIST_ID }),
        }),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "running"));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("leaves an item a bot is already working alone", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        teamModel({
          turnThread: failedDispatcherTurn(BOT_THREAD, "item-1", SPECIALIST_ID),
          item: workItem({ id: "item-1", state: "in-progress", ownerBotId: SPECIALIST_ID }),
        }),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "error"));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );
});
