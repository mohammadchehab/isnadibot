import { it } from "@effect/vitest";
import type { OrchestrationReadModel, OrchestrationThread } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import {
  MOVED_BOT,
  MOVED_GROUP,
  MOVED_THREAD,
  botThread,
  harness,
  idleTeamModel,
  keepBusyGroup,
  run,
  runningDispatcherTurn,
  sessionSet,
  settledDispatcherTurn,
  workItem,
  workItemAssigned,
} from "../test-support/FleetDispatcherFixtures.ts";

describe("FleetDispatcherReactor live-turn guard (TASK-267)", () => {
  /**
   * A released item in `GROUP_ID`, plus the moved bot whose chat still runs a dispatcher turn for
   * it. `MOVED_GROUP` is not kept busy: the wake has to reach the item's group on its own.
   */
  const movedModel = (turnThread: OrchestrationThread): OrchestrationReadModel => ({
    ...makeReadModel({
      bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }), MOVED_BOT],
      groups: [
        keepBusyGroup(),
        makeGroup({
          id: MOVED_GROUP,
          name: "Moved",
          bossBotId: null,
          members: [{ kind: "bot", botId: MOVED_BOT.id, role: "specialist" }],
        }),
      ],
      threads: [botThread(SPECIALIST_ID, "thread-bot-specialist"), turnThread],
    }),
    workItems: [workItem({ id: "item-1" })],
  });

  // A group move and a human unassign are the same event at this boundary: both leave the item
  // queued and unowned, and the guard keys on the turn's trigger rather than on how it got there.
  it.effect("holds a released item while a dispatcher turn for it is still running", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          // The restore sweep's own queue-empty receipt, consumed so the release's is what is left.
          yield* reactor.drain;
          yield* receipts;

          yield* Ref.set(
            h.model,
            movedModel(runningDispatcherTurn(MOVED_THREAD, "item-1", MOVED_BOT.id)),
          );
          yield* PubSub.publish(h.events, workItemAssigned(1, workItem({ id: "item-1" })));
          yield* reactor.drainThrough(1);

          expect(h.dispatched).toEqual([]);
          expect(yield* receipts).toMatchObject([
            {
              type: "fleet.dispatch.decided",
              kind: "skipped",
              reason: "turn-running",
              itemId: "item-1",
            },
          ]);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("wakes the item's current group when the turn that held it reports terminal", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* Ref.set(
            h.model,
            movedModel(runningDispatcherTurn(MOVED_THREAD, "item-1", MOVED_BOT.id)),
          );
          yield* PubSub.publish(h.events, sessionSet(1, MOVED_THREAD, "running"));

          // The turn settles and the read model catches up, as the turn projection would.
          yield* Ref.set(
            h.model,
            movedModel(settledDispatcherTurn(MOVED_THREAD, "item-1", MOVED_BOT.id)),
          );
          yield* PubSub.publish(h.events, sessionSet(2, MOVED_THREAD, "ready"));
          yield* reactor.drainThrough(2);

          // The thread's own group is the moved bot's, which owns nothing. Only the settled
          // turn's trigger carries the wake back to the group the item now belongs to.
          expect(h.dispatched.map((command) => command.type)).toEqual([
            "work-item.claim",
            "thread.turn.start",
          ]);
          expect(h.dispatched[0]).toMatchObject({ botId: SPECIALIST_ID, workItemId: "item-1" });
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("claims a released item at once when no turn is still working it", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* run(h, ({ reactor }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));
          yield* PubSub.publish(h.events, workItemAssigned(1, workItem({ id: "item-1" })));
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
});
