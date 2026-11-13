import {
  AuthSessionId,
  CommandId,
  WorkItemId,
  type OrchestrationCommand,
  type WorkItem,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  makeReadModel,
  makeBot,
  makeGroup,
  makeGroupThread,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  PERSON_ID,
  GROUP_ID,
  NOW,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * `group.delete` decides through `requireMutationActorAuthorized`
 * (decider/groups.ts), so being a person member of the group is enough to run it.
 * Unlike a bot delete, which only clears the bot's open items, the group cascade
 * deletes every work item the group holds — finished ones included — and detaches
 * every thread that belonged to it. This file holds the two halves of that
 * finding: what a plain member can do to a group today, and the refusal a guard
 * has to add once the architect rules on who may delete a group.
 */
const QUEUED_ITEM_ID = WorkItemId.make("item-queued");

const DONE_ITEM_ID = WorkItemId.make("item-done");

const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: QUEUED_ITEM_ID,
  groupId: GROUP_ID,
  title: "Fix the thing",
  brief: "It is broken.",
  kind: "task",
  state: "queued",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/** A group holding one queued item, one finished item and a group-owned thread. */
const makeGroupWithWork = () => ({
  ...makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
      makeBot({ id: OTHER_SPECIALIST_ID }),
    ],
    groups: [makeGroup()],
    threads: [makeGroupThread()],
  }),
  workItems: [makeItem(), makeItem({ id: DONE_ITEM_ID, title: "Ship the thing", state: "done" })],
});

const deleteGroupCommand = (commandId: string): OrchestrationCommand => ({
  type: "group.delete",
  commandId: CommandId.make(commandId),
  groupId: GROUP_ID,
});

const member = { personId: PERSON_ID, canManageGroups: false } as const;

const decide = (actor: NonNullable<Parameters<typeof decideOrchestrationCommand>[0]["actor"]>) =>
  decideOrchestrationCommand({
    command: deleteGroupCommand("cmd-member-delete"),
    readModel: makeGroupWithWork(),
    actor,
  });

it.layer(NodeServices.layer)("group delete authorization", (it) => {
  it.effect("refuses group.delete from a plain member who was never confirmed", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decide(member));

      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect(
    "today: a member's group.delete wipes every item in the group, finished ones included",
    () =>
      Effect.gen(function* () {
        const result = yield* decide(member);
        const events = Array.isArray(result) ? result : [result];

        const deletedItemIds = events.flatMap((event) =>
          event.type === "work-item.deleted" ? [event.payload.workItemId] : [],
        );

        const detachedThreads = events.filter((event) => event.type === "thread.ownership-updated");

        expect(deletedItemIds).toEqual([QUEUED_ITEM_ID, DONE_ITEM_ID]);
        expect(detachedThreads).toHaveLength(1);
        expect(events.at(-1)?.type).toBe("group.deleted");
      }),
  );

  it.effect("still lets an administrator delete the group", () =>
    Effect.gen(function* () {
      const result = yield* decide({
        personId: AuthSessionId.make("person-admin"),
        canManageGroups: true,
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.at(-1)?.type).toBe("group.deleted");
    }),
  );
});
