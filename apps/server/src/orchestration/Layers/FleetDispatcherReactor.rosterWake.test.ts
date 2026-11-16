import { it } from "@effect/vitest";
import { type BotId, ThreadId, TurnId, type OrchestrationThread } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  BOT_A,
  BOT_B,
  NOW,
  bossSet,
  botRestored,
  botThread,
  harness,
  keepBusyGroup,
  memberAssigned,
  memberUnassigned,
  run,
  workItem,
} from "../test-support/FleetDispatcherFixtures.ts";

/** A chat whose session is up and working: its bot is busy, so the pick skips it. */
const busyThread = (botId: BotId, id: string): OrchestrationThread => ({
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

/**
 * A roster change is the only event that can free a queue nobody can work: it touches no item, so
 * without these wakes the queued work waits for a turn end that will never come.
 */
describe("FleetDispatcherReactor roster wakes (TASK-245)", () => {
  it.effect("a bot joining the group wakes a queue that had no idle member", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const onlyMember = [{ kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const }];

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [BOT_A],
          groups: [keepBusyGroup({ bossBotId: null, members: onlyMember })],
          threads: [busyThread(BOT_A.id, "thread-a")],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The only member is working, so the item waits — and no item event will ever retry it.
          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "no-idle-member",
              itemId: "item-1",
            },
          ]);

          yield* Ref.set(h.model, {
            ...makeReadModel({
              bots: [BOT_A, BOT_B],
              groups: [
                keepBusyGroup({
                  bossBotId: null,
                  members: [
                    ...onlyMember,
                    { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
                  ],
                }),
              ],
              threads: [busyThread(BOT_A.id, "thread-a"), botThread(BOT_B.id, "thread-b")],
            }),
            workItems: [workItem({ id: "item-1" })],
          });
          yield* PubSub.publish(h.events, memberAssigned(1, BOT_B.id));
          yield* reactor.drainThrough(1);

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

  it.effect("a bot leaving the group wakes a queue whose only free candidate was the boss", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const roster = [
        { kind: "bot" as const, botId: BOT_A.id, role: "boss" as const },
        { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
      ];

      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [BOT_A, BOT_B],
          groups: [keepBusyGroup({ bossBotId: BOT_A.id, members: roster })],
          threads: [botThread(BOT_A.id, "thread-a"), busyThread(BOT_B.id, "thread-b")],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The specialist is working and the boss is not a candidate while a specialist exists.
          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([{ kind: "skipped", reason: "no-idle-member" }]);

          // The specialist leaves, so the boss is the group's only bot and the item can run.
          yield* Ref.set(h.model, {
            ...makeReadModel({
              bots: [BOT_A],
              groups: [
                keepBusyGroup({
                  bossBotId: BOT_A.id,
                  members: [{ kind: "bot" as const, botId: BOT_A.id, role: "boss" as const }],
                }),
              ],
              threads: [botThread(BOT_A.id, "thread-a")],
            }),
            workItems: [workItem({ id: "item-1" })],
          });
          yield* PubSub.publish(h.events, memberUnassigned(1, BOT_B.id));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id, workItemId: "item-1" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("restoring a bot wakes the queue it left when it was archived", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The restore names only the bot, so the group has to come from the read model.
      const archivedModel = (archivedAt: string | null) => ({
        ...makeReadModel({
          bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID, archivedAt })],
          groups: [keepBusyGroup()],
          threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* Ref.set(h.model, archivedModel(NOW));

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // An archived bot is never a candidate, so the item waits with nothing to retry it.
          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "no-idle-member",
              itemId: "item-1",
            },
          ]);

          yield* Ref.set(h.model, archivedModel(null));
          yield* PubSub.publish(h.events, botRestored(1, SPECIALIST_ID));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: SPECIALIST_ID, workItemId: "item-1" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a boss change re-picks from the roster it left behind", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const model = (
        bossBotId: BotId,
        members: ReadonlyArray<{ botId: BotId; role: "boss" | "specialist" }>,
        itemId: string,
      ) => ({
        ...makeReadModel({
          bots: [BOT_A, BOT_B],
          groups: [
            keepBusyGroup({
              bossBotId,
              members: members.map((member) => ({
                kind: "bot" as const,
                botId: member.botId,
                role: member.role,
              })),
            }),
          ],
          threads: [botThread(BOT_A.id, "thread-a"), botThread(BOT_B.id, "thread-b")],
        }),
        workItems: [workItem({ id: itemId })],
      });

      // BOT_B is the boss, so BOT_A is the specialist the pick prefers.
      yield* Ref.set(
        h.model,
        model(
          BOT_B.id,
          [
            { botId: BOT_A.id, role: "specialist" },
            { botId: BOT_B.id, role: "boss" },
          ],
          "item-1",
        ),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id, workItemId: "item-1" });

          // The item it took is now its own, and the boss moves: BOT_A is the boss and working,
          // BOT_B the specialist, so only the new split lets the second item run.
          h.dispatched.length = 0;
          yield* Ref.set(h.model, {
            ...model(
              BOT_A.id,
              [
                { botId: BOT_A.id, role: "boss" },
                { botId: BOT_B.id, role: "specialist" },
              ],
              "item-2",
            ),
            workItems: [
              workItem({ id: "item-1", state: "in-progress", ownerBotId: BOT_A.id }),
              workItem({ id: "item-2" }),
            ],
          });
          yield* PubSub.publish(h.events, bossSet(1, BOT_A.id, BOT_B.id));
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_B.id, workItemId: "item-2" });
        }),
      );
    }).pipe(Effect.scoped),
  );
});
