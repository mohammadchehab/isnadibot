import { it } from "@effect/vitest";
import {
  type BotId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type WorkItem,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import { makeGroupThread, makeReadModel } from "../test-support/GroupDeciderFixtures.ts";
import {
  type Ac3Thread,
  BOT_A,
  BOT_B,
  LATEST,
  NOW,
  harness,
  keepBusyGroup,
  run,
  workItem,
} from "../test-support/FleetDispatcherFixtures.ts";

const MEMBERS = [
  { kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const },
  { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
];

/** A bot's own chat whose last turn finished at `completedAt`, or none when it never had one. */
const finished = (botId: BotId, id: string, completedAt?: string): Ac3Thread => ({
  ...makeGroupThread(),
  id: ThreadId.make(id),
  botId,
  groupId: null,
  session: null,
  latestTurn:
    completedAt === undefined
      ? null
      : {
          turnId: TurnId.make(`turn-${botId}`),
          state: "completed",
          requestedAt: completedAt,
          startedAt: completedAt,
          completedAt,
          assistantMessageId: null,
        },
  hasPendingApprovals: false,
  hasPendingUserInput: false,
});

/** Two free specialists, one item waiting, and nothing for a model to decide. */
const twoIdleBots = (
  threads: ReadonlyArray<Ac3Thread>,
  items: ReadonlyArray<WorkItem> = [workItem({ id: "item-1" })],
): OrchestrationReadModel => ({
  ...makeReadModel({
    bots: [BOT_A, BOT_B],
    groups: [keepBusyGroup({ bossBotId: null, members: MEMBERS })],
    threads,
  }),
  workItems: items,
});

describe("FleetDispatcherReactor pick order (AC7)", () => {
  it.effect("gives the item to the member idle longest, not the lowest id", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        twoIdleBots([
          // BOT_A finished a second ago, BOT_B has been free since the start of the day.
          finished(BOT_A.id, "thread-a", LATEST),
          finished(BOT_B.id, "thread-b", NOW),
        ]),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_B.id, workItemId: "item-1" });
          expect(h.dispatched[1]).toMatchObject({ threadId: ThreadId.make("thread-b") });
          // No second bot is woken for the same item, and nothing was asked to choose.
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "assigned",
              itemId: "item-1",
              botId: BOT_B.id,
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("gives it to the member that never had a turn before one that just finished", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        twoIdleBots([finished(BOT_A.id, "thread-a"), finished(BOT_B.id, "thread-b", NOW)]),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id, workItemId: "item-1" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("breaks an equal idle time with the lowest bot id", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        twoIdleBots([finished(BOT_A.id, "thread-a", NOW), finished(BOT_B.id, "thread-b", NOW)]),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("passes over a member with no chat for one that has one", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // BOT_A never opened a chat, so having no turn at all it ranks first; a chatless member
      // cannot be started, and the item goes to BOT_B rather than to nobody.
      yield* Ref.set(h.model, twoIdleBots([finished(BOT_B.id, "thread-b", LATEST)]));

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_B.id, workItemId: "item-1" });
          expect(h.dispatched[1]).toMatchObject({ threadId: ThreadId.make("thread-b") });
        }),
      );
    }).pipe(Effect.scoped),
  );
});
