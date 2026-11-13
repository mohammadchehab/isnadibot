import { it } from "@effect/vitest";
import {
  type BotId,
  type GroupId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkItem,
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
  makeGroupThread,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  type Ac3Thread,
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
  turnDiffCompleted,
  workItem,
  workItemCreated,
} from "../test-support/FleetDispatcherFixtures.ts";

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
});

describe("FleetDispatcherReactor idle rule (AC3)", () => {
  const runningTurn = (botId: BotId) => ({
    turnId: TurnId.make("turn-1"),
    state: "running" as const,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    assistantMessageId: null,
    respondingBotId: botId,
  });

  /** A bot's own chat, as the shell serves it: a thread plus the pending flags AC3 reads. */
  const botShell = (input: {
    readonly botId: BotId | null;
    readonly id: string;
    readonly groupId?: GroupId | null;
    readonly respondingBotId?: BotId | null;
    readonly hasPendingApprovals?: boolean;
    readonly hasPendingUserInput?: boolean;
    readonly running?: BotId | null;
  }): Ac3Thread => ({
    ...makeGroupThread(),
    id: ThreadId.make(input.id),
    botId: input.botId,
    groupId: input.groupId ?? null,
    respondingBotId: input.respondingBotId ?? null,
    session: null,
    latestTurn:
      input.running === undefined || input.running === null ? null : runningTurn(input.running),
    hasPendingApprovals: input.hasPendingApprovals ?? false,
    hasPendingUserInput: input.hasPendingUserInput ?? false,
  });

  const modelWith = (
    threads: ReadonlyArray<Ac3Thread>,
    items: ReadonlyArray<WorkItem>,
  ): OrchestrationReadModel => ({
    ...idleTeamModel(items),
    threads,
  });

  const expectSkipped = (
    h: Effect.Success<typeof harness>,
    receipts: Effect.Effect<ReadonlyArray<OrchestrationRuntimeReceipt>>,
  ) =>
    Effect.gen(function* () {
      expect(h.dispatched).toEqual([]);
      expect(yield* receipts).toMatchObject([
        { type: "fleet.dispatch.decided", kind: "skipped", reason: "no-idle-member" },
      ]);
    });

  it.effect("does not wake a bot that is waiting on the user's answer", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({
              botId: SPECIALIST_ID,
              id: "thread-bot-specialist",
              hasPendingUserInput: true,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not wake a bot that has an approval pending", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({
              botId: SPECIALIST_ID,
              id: "thread-bot-specialist",
              hasPendingApprovals: true,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not wake a bot that holds a blocked item", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [botShell({ botId: SPECIALIST_ID, id: "thread-bot-specialist" })],
          [
            workItem({ id: "item-held", state: "blocked", ownerBotId: SPECIALIST_ID }),
            workItem({ id: "item-1", createdAt: LATER }),
          ],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not start a turn inside a group responder queue that is running", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The specialist is answering in the group chat while its own chat sits idle, so only the
      // shared rule — which follows who a chat's responder is — can see it is busy.
      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({ botId: SPECIALIST_ID, id: "thread-bot-specialist" }),
            botShell({
              botId: null,
              id: "thread-group",
              groupId: GROUP_ID,
              respondingBotId: SPECIALIST_ID,
              running: SPECIALIST_ID,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );
});

describe("FleetDispatcherReactor pick order (AC7)", () => {
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
});
