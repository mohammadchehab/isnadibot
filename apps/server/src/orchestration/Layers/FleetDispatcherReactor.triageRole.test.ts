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

/**
 * An item may name the role that should take it. The dispatcher never hands such an item to
 * whoever happens to be free — but it must never let the item quietly sit there either, and a
 * member gaining the role has to be enough to move it, without a restart.
 */
describe("FleetDispatcherReactor triage by role (TASK-447)", () => {
  it.effect("an item naming a role nobody holds is not handed out, and the chat says why", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [BOT_A],
          [botThread(BOT_A.id, "thread-a"), makeGroupThread()],
          [workItem({ id: "item-1", role: ARCHITECT })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The only member is idle and would have taken it before this rule existed.
          expect(claims(h.dispatched)).toEqual([]);

          // Guard (i): the wait is visible, and the row names the role that would unblock it.
          expect(triageNotes(h.dispatched)).toMatchObject([
            {
              threadId: ThreadId.make("thread-group"),
              activity: { payload: { workItemId: "item-1", role: ARCHITECT } },
            },
          ]);
          expect(yield* receipts).toMatchObject([
            { kind: "skipped", reason: "no-role-holder", itemId: "item-1" },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a starved item does not stop the item behind it from being handed out", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The starved item is the oldest, so the pass meets it first.
      yield* Ref.set(
        h.model,
        modelWith(
          [BOT_A],
          [botThread(BOT_A.id, "thread-a"), makeGroupThread()],
          [workItem({ id: "item-1", role: ARCHITECT }), workItem({ id: "item-2" })],
        ),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // Only the item that named no role moved, and it moved rather than waiting its turn.
          expect(claims(h.dispatched)).toMatchObject([{ workItemId: "item-2" }]);
          expect(triageNotes(h.dispatched)).toHaveLength(1);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a member gaining the role re-opens the item without a restart", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      const threads = [
        botThread(BOT_A.id, "thread-a"),
        botThread(ARCHITECT_BOT.id, "thread-architect"),
        makeGroupThread(),
      ];
      const item = [workItem({ id: "item-1", role: ARCHITECT })];

      yield* Ref.set(h.model, modelWith([BOT_A], threads, item));

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          expect(claims(h.dispatched)).toEqual([]);

          // Guard (ii): the roster change is the only thing that happens, and the same reactor
          // hands the item out on the wake it causes.
          yield* Ref.set(h.model, modelWith([BOT_A, ARCHITECT_BOT], threads, item));
          yield* PubSub.publish(h.events, memberAssigned(1, ARCHITECT_BOT.id));
          yield* reactor.drainThrough(1);

          expect(claims(h.dispatched)).toMatchObject([
            { workItemId: "item-1", botId: ARCHITECT_BOT.id },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("an item naming a role the group does hold goes to the member hired as it", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [BOT_A, ARCHITECT_BOT],
          [botThread(BOT_A.id, "thread-a"), botThread(ARCHITECT_BOT.id, "thread-architect")],
          [workItem({ id: "item-1", role: ARCHITECT })],
        ),
      );

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // Both are idle, and only one was hired as the architect.
          expect(claims(h.dispatched)).toMatchObject([
            { workItemId: "item-1", botId: ARCHITECT_BOT.id },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("a role that is held but busy waits on the member, not on the role", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [BOT_A, ARCHITECT_BOT],
          [busyThread(ARCHITECT_BOT.id, "thread-architect"), botThread(BOT_A.id, "thread-a")],
          [workItem({ id: "item-1", role: ARCHITECT })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          // The free member was not hired as the architect, so the item waits for the one who was.
          expect(claims(h.dispatched)).toEqual([]);

          // A held role whose holder is busy is a different answer from a role nobody holds, and
          // it is not the one the chat should be told about.
          expect(yield* receipts).toMatchObject([{ kind: "skipped", reason: "no-idle-member" }]);
          expect(triageNotes(h.dispatched)).toEqual([]);
        }),
      );
    }).pipe(Effect.scoped),
  );
});
