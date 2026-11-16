import {
  BotId,
  CommandId,
  TurnId,
  WorkItemId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThread,
  type WorkItem,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  OTHER_SPECIALIST_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "./test-support/GroupDeciderFixtures.ts";
import { BOT_THREAD, botThread } from "./test-support/FleetDispatcherFixtures.ts";

const ITEM_ID = WorkItemId.make("item-1");

const TURN_ID = TurnId.make("turn-1");

/** An item the dispatcher handed to the specialist and the specialist has not moved on. */
const assigned = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: ITEM_ID,
  groupId: GROUP_ID,
  title: "Fix the thing",
  brief: "It is broken.",
  kind: "task",
  state: "assigned",
  ownerBotId: SPECIALIST_ID,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/** The server-internal command the dispatcher sends when a turn it started is over. */
const dispatcherFailed = (
  input: {
    readonly cause?: "interrupted" | "dead";
    readonly botId?: BotId;
    readonly turnId?: TurnId;
    readonly detail?: string;
  } = {},
): OrchestrationCommand => ({
  type: "work-item.dispatcher-failed",
  commandId: CommandId.make("cmd-work-item.dispatcher-failed"),
  botId: input.botId ?? SPECIALIST_ID,
  workItemId: ITEM_ID,
  threadId: BOT_THREAD,
  turnId: input.turnId ?? TURN_ID,
  cause: input.cause ?? "dead",
  ...(input.detail === undefined ? {} : { detail: input.detail }),
  createdAt: NOW,
});

const decide = (
  command: OrchestrationCommand,
  items: ReadonlyArray<WorkItem>,
  threads: ReadonlyArray<OrchestrationThread> = [botThread(SPECIALIST_ID, "thread-bot-specialist")],
) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({
      command,
      readModel: {
        ...makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
            makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
            makeBot({ id: OTHER_SPECIALIST_ID }),
          ],
          groups: [makeGroup()],
          threads,
        }),
        workItems: items,
      },
    });

    return Array.isArray(result) ? result : [result];
  });

/** The item the plan carries, from whichever event the decider emitted for it. */
const changed = (events: ReadonlyArray<OrchestrationEvent>): WorkItem => {
  const payload = events[0]?.payload;

  if (payload === undefined || !("workItem" in payload)) throw new Error("no work item payload");

  return payload.workItem;
};

it.layer(NodeServices.layer)("work item dispatcher-failed decider (TASK-240)", (it) => {
  it.effect("plans nothing for an item the reporting bot does not hold", () =>
    Effect.gen(function* () {
      // Someone else's item: a bot may not move work it was not given.
      expect(
        yield* decide(dispatcherFailed(), [assigned({ ownerBotId: OTHER_SPECIALIST_ID })]),
      ).toHaveLength(0);

      // Not assigned: the dispatcher's turn cannot have been working it.
      expect(yield* decide(dispatcherFailed(), [assigned({ state: "queued" })])).toHaveLength(0);
      expect(yield* decide(dispatcherFailed(), [assigned({ state: "in-progress" })])).toHaveLength(
        0,
      );

      // Finished: history keeps its owner, and nothing is put back in the queue.
      expect(
        yield* decide(dispatcherFailed(), [assigned({ state: "done", doneAt: NOW })]),
      ).toHaveLength(0);
    }),
  );

  it.effect("requeues an item whose dispatcher turn died and counts the death", () =>
    Effect.gen(function* () {
      const events = yield* decide(dispatcherFailed({ detail: "provider exited" }), [assigned()]);

      expect(events[0]?.type).toBe("work-item.assigned");
      expect(changed(events)).toMatchObject({ state: "queued", attempts: 1 });
      expect(changed(events).ownerBotId).toBeUndefined();
    }),
  );

  it.effect("requeues an interrupted item without counting a failure", () =>
    Effect.gen(function* () {
      const events = yield* decide(dispatcherFailed({ cause: "interrupted" }), [assigned()]);

      expect(events[0]?.type).toBe("work-item.assigned");
      expect(changed(events)).toMatchObject({ state: "queued", attempts: 0 });
    }),
  );

  it.effect(
    "blocks an item whose second dispatcher turn in a row died, with the reason on it",
    () =>
      Effect.gen(function* () {
        const events = yield* decide(dispatcherFailed({ detail: "provider exited" }), [
          assigned({ attempts: 1 }),
        ]);

        // Blocking puts the reason on the item, where the standup row reads it; no chat line.
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe("work-item.blocked");

        const item = changed(events);

        expect(item).toMatchObject({
          state: "blocked",
          blockedFrom: "assigned",
          attempts: 2,
          ownerBotId: SPECIALIST_ID,
        });
        expect(item.blockedOn).toMatchObject({ by: "bot", botId: SPECIALIST_ID });
        expect(item.blockedOn?.note).toContain("provider exited");
      }),
  );

  it.effect("keeps the block note inside the length a card can show", () =>
    Effect.gen(function* () {
      const item = changed(
        yield* decide(dispatcherFailed({ detail: "x".repeat(400) }), [assigned({ attempts: 1 })]),
      );

      expect(item.blockedOn?.note).toHaveLength(200);
      expect(item.blockedOn?.note?.endsWith("…")).toBe(true);
    }),
  );

  it.effect("says in the chat why the item came back", () =>
    Effect.gen(function* () {
      const events = yield* decide(dispatcherFailed({ cause: "interrupted" }), [assigned()]);

      expect(events[1]?.type).toBe("thread.message-sent");

      const message = events[1]?.payload;

      if (message === undefined || !("messageId" in message))
        return expect.fail("expected a chat line");

      expect(message.messageId).toBe("work-item-dispatch-failed:item-1:turn-1");
      expect(message.role).toBe("system");
      expect(message.text).toContain("was interrupted");
      expect(message.text).toContain("Fix the thing");
    }),
  );

  it.effect("names the bot whose turn it was, not the bot that owns the item now", () =>
    Effect.gen(function* () {
      // The card was re-assigned moments before the reap, so the item's owner is the specialist
      // while the turn that ended ran in the other specialist's chat.
      const events = yield* decide(
        dispatcherFailed({ cause: "interrupted" }),
        [assigned()],
        [botThread(OTHER_SPECIALIST_ID, "thread-bot-specialist")],
      );

      const message = events[1]?.payload;

      if (message === undefined || !("text" in message)) return expect.fail("expected a chat line");

      expect(message.text).toContain(`${OTHER_SPECIALIST_ID}'s turn`);
      expect(message.text).not.toContain(`${SPECIALIST_ID}'s turn`);
    }),
  );

  it.effect("keys the chat line on the turn, so a later turn posts its own", () =>
    Effect.gen(function* () {
      const first = yield* decide(dispatcherFailed({ cause: "interrupted" }), [assigned()]);

      const second = yield* decide(
        dispatcherFailed({ cause: "interrupted", turnId: TurnId.make("turn-2") }),
        [assigned()],
      );

      const messageIdOf = (events: ReadonlyArray<OrchestrationEvent>) => {
        const payload = events[1]?.payload;

        return payload !== undefined && "messageId" in payload ? payload.messageId : undefined;
      };

      // Both turns count no failure, so an id keyed on the attempt count would collide here.
      expect(messageIdOf(first)).toBe("work-item-dispatch-failed:item-1:turn-1");
      expect(messageIdOf(second)).toBe("work-item-dispatch-failed:item-1:turn-2");
    }),
  );

  it.effect("plans no chat line for a chat that is gone", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        dispatcherFailed(),
        [assigned()],
        [{ ...botThread(SPECIALIST_ID, "thread-bot-specialist"), deletedAt: NOW }],
      );

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("work-item.assigned");
    }),
  );
});
