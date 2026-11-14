import { it } from "@effect/vitest";
import {
  BotId,
  GroupId,
  ThreadId,
  TurnId,
  WorkItemId,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationRuntimeReceipt } from "../Services/RuntimeReceiptBus.ts";
import {
  BOSS_ID,
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  type OnCommand,
  BOT_A,
  BOT_B,
  BOT_THREAD,
  LATER,
  LATEST,
  NOW,
  botThread,
  harness,
  idleTeamModel,
  keepBusyGroup,
  keepBusySet,
  run,
  sessionSet,
  threadCreated,
  turnDiffCompleted,
  workItem,
  workItemCreated,
} from "../test-support/FleetDispatcherFixtures.ts";

/** A second keep-busy group, so one pass can be seen deciding two. */
const SECOND_GROUP_ID = GroupId.make("group-second");

/** An owner outside the group: the item was taken by someone else. */
const OTHER_BOT_ID = BotId.make("bot-other");

/**
 * The projector's effect for a claim, so a pass that re-reads the model sees what the command
 * did. A claimed item belongs to the bot; a refused one was taken elsewhere, so it belongs to a
 * stranger. Either way it leaves the queue.
 */
const takeWorkItem =
  (h: Effect.Success<typeof harness>): OnCommand =>
  (command, outcome) =>
    Effect.gen(function* () {
      if (command.type !== "work-item.claim") return;

      yield* Ref.update(h.model, (model) => ({
        ...model,
        workItems: (model.workItems ?? []).map((item) =>
          item.id === command.workItemId
            ? {
                ...item,
                state: "in-progress" as const,
                ownerBotId: outcome === "accepted" ? command.botId : OTHER_BOT_ID,
              }
            : item,
        ),
      }));
    });

/** The decisions themselves: a re-run that finds the queue empty says so, and is not one. */
const decisions = (receipts: ReadonlyArray<OrchestrationRuntimeReceipt>) =>
  receipts.filter(
    (receipt) => receipt.type === "fleet.dispatch.decided" && receipt.reason !== "queue-empty",
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
            trigger: { kind: "dispatcher", workItemId: "item-1" },
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

  it.effect("never raises the chat's runtime mode or interaction mode for a brief", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The chat sits on stricter modes than the session reports; the chat's modes govern.
          yield* Ref.set(h.model, {
            ...idleTeamModel([workItem({ id: "item-1" })]),
            threads: [
              {
                ...botThread(SPECIALIST_ID, "thread-bot-specialist"),
                runtimeMode: "approval-required",
                interactionMode: "plan",
              },
            ],
          });
          yield* PubSub.publish(h.events, sessionSet(1, BOT_THREAD, "running"));
          yield* PubSub.publish(h.events, sessionSet(2, BOT_THREAD, "ready"));
          yield* reactor.drainThrough(2);

          expect(h.dispatched.filter((command) => command.type === "thread.turn.start")).toEqual([
            expect.objectContaining({
              runtimeMode: "approval-required",
              interactionMode: "default",
            }),
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

  it.effect("does not let one chatless member stop the group", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const members = [
        { kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const },
        { kind: "bot" as const, botId: BOT_B.id, role: "specialist" as const },
      ];

      // BOT_A never opened a chat, so with no turn it ranks first; BOT_B has one and takes the item.
      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [BOT_A, BOT_B],
          groups: [keepBusyGroup({ bossBotId: null, members })],
          threads: [botThread(BOT_B.id, "thread-b")],
        }),
        workItems: [workItem({ id: "item-1" })],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_B.id, workItemId: "item-1" });
          expect(h.dispatched[1]).toMatchObject({ threadId: ThreadId.make("thread-b") });
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

  it.effect("skips a group whose members have no chat once, and names the bot", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // A freshly hired group: nothing in the decider creates a chat, so none exists yet.
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

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toEqual([
            expect.objectContaining({
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "no-chat",
              botId: SPECIALIST_ID,
            }),
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("drains the queue when the missing chat appears", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const chatless: OrchestrationReadModel = {
        ...makeReadModel({
          bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
          groups: [keepBusyGroup()],
          threads: [],
        }),
        workItems: [workItem({ id: "item-1" })],
      };

      yield* Ref.set(h.model, chatless);

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([{ kind: "skipped", reason: "no-chat" }]);

          // The user opens the bot's chat: the thread is projected and its event arrives. That
          // event alone is what wakes the group — no turn ends and no item is touched.
          yield* Ref.set(h.model, {
            ...chatless,
            threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
          });
          yield* PubSub.publish(
            h.events,
            threadCreated(1, { threadId: BOT_THREAD, botId: SPECIALIST_ID }),
          );
          yield* reactor.drainThrough(1);

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
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

  it.effect("spends a bot once per pass across two keep-busy groups", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const members = [{ kind: "bot" as const, botId: BOT_A.id, role: "specialist" as const }];

      // One free bot, a member of two groups, each with its own item waiting. One pass decides
      // both groups from one snapshot, so the second group must not be handed the same bot.
      yield* Ref.set(h.model, {
        ...makeReadModel({
          bots: [BOT_A],
          groups: [
            keepBusyGroup({ bossBotId: null, members }),
            { ...keepBusyGroup({ bossBotId: null, members }), id: SECOND_GROUP_ID },
          ],
          threads: [botThread(BOT_A.id, "thread-a")],
        }),
        workItems: [
          workItem({ id: "item-first", createdAt: NOW }),
          workItem({ id: "item-second", createdAt: LATER, groupId: SECOND_GROUP_ID }),
        ],
      });

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: BOT_A.id, workItemId: "item-first" });
          // The second group had nothing left to hand out, and says nothing about it.
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "assigned",
              itemId: "item-first",
              botId: BOT_A.id,
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("dispatches the rest of the queue after a lost claim", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // Someone else took the first item: the read model in hand still shows it queued.
      yield* Ref.set(h.rejection, {
        type: "work-item.claim",
        workItemId: WorkItemId.make("item-taken"),
        error: new OrchestrationCommandInvariantError({
          commandType: "work-item.claim",
          detail: "Work item 'item-taken' is no longer queued.",
        }),
      });
      yield* Ref.set(h.onCommand, takeWorkItem(h));
      yield* Ref.set(
        h.model,
        idleTeamModel([
          workItem({ id: "item-taken", createdAt: NOW }),
          workItem({ id: "item-next", createdAt: LATER }),
        ]),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: SPECIALIST_ID, workItemId: "item-next" });
          // The rest of the queue drains on the loss alone: the re-run that follows finds it empty.
          expect(decisions(yield* receipts)).toMatchObject([
            { kind: "skipped", reason: "claim-lost", itemId: "item-taken" },
            { kind: "assigned", itemId: "item-next", botId: SPECIALIST_ID },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("publishes one claim-lost receipt however many claims are lost", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(h.rejection, {
        type: "work-item.claim",
        error: new OrchestrationCommandInvariantError({
          commandType: "work-item.claim",
          detail: "Work item is no longer queued.",
        }),
      });
      yield* Ref.set(h.onCommand, takeWorkItem(h));
      yield* Ref.set(
        h.model,
        idleTeamModel([
          workItem({ id: "item-1", createdAt: NOW }),
          workItem({ id: "item-2", createdAt: LATER }),
          workItem({ id: "item-3", createdAt: LATEST }),
        ]),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(h.dispatched).toEqual([]);

          const lost = (yield* receipts).filter(
            (receipt) =>
              receipt.type === "fleet.dispatch.decided" && receipt.reason === "claim-lost",
          );

          expect(lost).toHaveLength(1);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("retries the queue after a lost claim with no further event", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The claim is refused once, as a stale pass is, and succeeds when the group re-reads.
      yield* Ref.set(h.rejection, {
        type: "work-item.claim",
        error: new OrchestrationCommandInvariantError({
          commandType: "work-item.claim",
          detail: "Work item 'item-1' is no longer queued.",
        }),
        remaining: 1,
      });
      yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // Nothing else arrives between the two passes: the loss itself wakes the group.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(yield* receipts).toMatchObject([
            { kind: "skipped", reason: "claim-lost" },
            { kind: "assigned", itemId: "item-1", botId: SPECIALIST_ID },
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
});
