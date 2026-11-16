import { it } from "@effect/vitest";
import {
  FLEET_DISPATCH_TRIAGE_ACTIVITY,
  FleetRoleId,
  ThreadId,
  TurnId,
  type BotId,
  type GroupMembership,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import {
  GROUP_ID,
  makeBot,
  makeGroupThread,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  BOT_A,
  NOW,
  botThread,
  fleetDecisions,
  harness,
  keepBusyGroup,
  memberAssigned,
  run,
  workItem,
} from "../test-support/FleetDispatcherFixtures.ts";

const ARCHITECT = FleetRoleId.make("architect");

/** A bot hired as the architect, so it is the one member an architect item may go to. */
const ARCHITECT_BOT = makeBot({
  id: "bot-architect" as BotId,
  groupId: GROUP_ID,
  roleId: ARCHITECT,
});

const specialist = (botId: BotId): GroupMembership => ({ kind: "bot", botId, role: "specialist" });

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

/** A read model whose one group holds `bots`, with the board carrying `items`. */
const modelWith = (
  bots: ReadonlyArray<OrchestrationBot>,
  threads: ReadonlyArray<OrchestrationThread>,
  items: ReadonlyArray<ReturnType<typeof workItem>>,
) => ({
  ...makeReadModel({
    bots,
    groups: [keepBusyGroup({ bossBotId: null, members: bots.map((bot) => specialist(bot.id)) })],
    threads,
  }),
  workItems: items,
});

/** The claims themselves, so a test can say which bot took which item. */
const claims = (dispatched: ReadonlyArray<OrchestrationCommand>) =>
  dispatched.flatMap((command) => (command.type === "work-item.claim" ? [command] : []));

/** The triage rows the reactor left in the group's chat. */
const triageNotes = (dispatched: ReadonlyArray<OrchestrationCommand>) =>
  dispatched.filter(
    (command) =>
      command.type === "thread.activity.append" &&
      command.activity.kind === FLEET_DISPATCH_TRIAGE_ACTIVITY,
  );

/** The one architect item, on a board that may also carry items naming no role. */
const board = (...extra: ReadonlyArray<ReturnType<typeof workItem>>) => [
  workItem({ id: "item-1", role: ARCHITECT }),
  ...extra,
];

/**
 * One drained pass over a board holding the architect item, with the architect's chat idle or
 * busy and a free specialist there either way. The two answers a held role can give come from
 * the same board, so both cases read it here rather than each building it.
 */
const dispatchWithArchitect = (architectChat: "idle" | "busy") =>
  Effect.gen(function* () {
    const h = yield* harness;

    yield* Ref.set(
      h.model,
      modelWith(
        [BOT_A, ARCHITECT_BOT],
        [
          architectChat === "busy"
            ? busyThread(ARCHITECT_BOT.id, "thread-architect")
            : botThread(ARCHITECT_BOT.id, "thread-architect"),
          botThread(BOT_A.id, "thread-a"),
        ],
        board(),
      ),
    );

    return yield* run(h, ({ reactor, receipts }) =>
      Effect.gen(function* () {
        yield* reactor.drain;

        return { dispatched: h.dispatched, receipts: yield* receipts };
      }),
    );
  }).pipe(Effect.scoped);

/**
 * An item may name the role that should take it. The dispatcher never hands such an item to
 * whoever happens to be free — but it must never let the item quietly sit there either, and a
 * member gaining the role has to be enough to move it, without a restart.
 */
describe("FleetDispatcherReactor triage by role (TASK-447)", () => {
  it.effect("a starved item is skipped and the chat says why, while the item behind it moves", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The starved item is the oldest, so the pass meets it first.
      yield* Ref.set(
        h.model,
        modelWith(
          [BOT_A],
          [botThread(BOT_A.id, "thread-a"), makeGroupThread()],
          board(workItem({ id: "item-2" })),
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // Guard (i): the wait is visible, and the row names the role that would unblock it.
          expect(triageNotes(h.dispatched)).toMatchObject([
            {
              threadId: ThreadId.make("thread-group"),
              activity: { payload: { workItemId: "item-1", role: ARCHITECT } },
            },
          ]);
          expect(
            fleetDecisions(yield* receipts).filter((receipt) => receipt.kind === "skipped"),
          ).toMatchObject([{ kind: "skipped", reason: "no-role-holder", itemId: "item-1" }]);
          // The free member took the item behind it, so one starved item is not a stop sign.
          expect(claims(h.dispatched)).toMatchObject([{ workItemId: "item-2", botId: BOT_A.id }]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a member gaining the role hands the item out without a restart", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const threads = [
        botThread(BOT_A.id, "thread-a"),
        botThread(ARCHITECT_BOT.id, "thread-architect"),
        makeGroupThread(),
      ];

      yield* Ref.set(h.model, modelWith([BOT_A], threads, board()));

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(claims(h.dispatched)).toEqual([]);

          // Guard (ii): the roster change is the only thing that happens, and the same reactor
          // hands the item out on the wake it causes.
          yield* Ref.set(h.model, modelWith([BOT_A, ARCHITECT_BOT], threads, board()));
          yield* PubSub.publish(h.events, memberAssigned(1, ARCHITECT_BOT.id));
          yield* reactor.drainThrough(1);

          expect(claims(h.dispatched)).toMatchObject([
            { workItemId: "item-1", botId: ARCHITECT_BOT.id },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a named role goes to its holder, and waits quietly while that holder is busy", () =>
    Effect.gen(function* () {
      // The two answers a held role can give, from the same board: one bot was hired as the
      // architect and one was not, so a free specialist never stands in for it.
      const idle = yield* dispatchWithArchitect("idle");

      expect(claims(idle.dispatched)).toMatchObject([
        { workItemId: "item-1", botId: ARCHITECT_BOT.id },
      ]);

      const busy = yield* dispatchWithArchitect("busy");

      // A held role whose holder is busy waits on that member, and is not the answer the chat
      // should be told about.
      expect(claims(busy.dispatched)).toEqual([]);
      expect(busy.receipts).toMatchObject([{ kind: "skipped", reason: "no-idle-member" }]);
      expect(triageNotes(busy.dispatched)).toEqual([]);
    }).pipe(Effect.scoped),
  );
});
