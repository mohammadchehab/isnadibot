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
import * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
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
 * `group.delete` is an environment-level act: only a person holding
 * `access:write` (behind `canManageGroups`) may run it, plain membership is not
 * enough. And because the cascade deletes every work item the group holds,
 * finished ones included, a group that still has open work refuses to delete
 * unless the caller passes `discardWorkItems` explicitly. Both refusals happen
 * before any event is planned, so a failed delete leaves the group, its items
 * and its threads exactly as they were.
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

/** The same group once its only open item is finished, so nothing is at stake. */
const makeGroupWithFinishedWorkOnly = () => ({
  ...makeGroupWithWork(),
  workItems: [makeItem({ id: DONE_ITEM_ID, title: "Ship the thing", state: "done" })],
});

const deleteGroupCommand = (input: {
  readonly commandId: string;
  readonly discardWorkItems?: boolean;
}): OrchestrationCommand => ({
  type: "group.delete",
  commandId: CommandId.make(input.commandId),
  groupId: GROUP_ID,
  ...(input.discardWorkItems === undefined ? {} : { discardWorkItems: input.discardWorkItems }),
});

const MEMBER = { personId: PERSON_ID, canManageGroups: false } as const;

const ADMIN = { personId: AuthSessionId.make("person-admin"), canManageGroups: true } as const;

const decide = (input: {
  readonly actor: { readonly personId: AuthSessionId; readonly canManageGroups: boolean };
  readonly discardWorkItems?: boolean;
  readonly readModel?: ReturnType<typeof makeGroupWithWork>;
}) =>
  decideOrchestrationCommand({
    command: deleteGroupCommand({
      commandId: "cmd-group-delete",
      ...(input.discardWorkItems === undefined ? {} : { discardWorkItems: input.discardWorkItems }),
    }),
    readModel: input.readModel ?? makeGroupWithWork(),
    actor: input.actor,
  });

const failureDetail = (
  result: Result.Result<unknown, OrchestrationCommandInvariantError | PlatformError.PlatformError>,
) =>
  Result.isFailure(result) &&
  Predicate.isTagged(result.failure, "OrchestrationCommandInvariantError")
    ? result.failure.detail
    : "";

it.layer(NodeServices.layer)("group delete authorization", (it) => {
  it.effect("refuses group.delete from a plain member who was never confirmed", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decide({ actor: MEMBER }));

      expect(result._tag).toBe("Failure");
      expect(failureDetail(result)).toContain("needs 'access:write'");
    }),
  );

  it.effect("refuses group.delete from a plain member even when they ask to discard the work", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(decide({ actor: MEMBER, discardWorkItems: true }));

      expect(result._tag).toBe("Failure");
      expect(failureDetail(result)).toContain("needs 'access:write'");
    }),
  );

  it.effect(
    "an administrator deleting a group that still holds open work must say discardWorkItems",
    () =>
      Effect.gen(function* () {
        const result = yield* Effect.result(decide({ actor: ADMIN }));

        expect(result._tag).toBe("Failure");
        expect(failureDetail(result)).toContain("still holds 1 open work item(s)");
      }),
  );

  it.effect(
    "an administrator who says discardWorkItems deletes the group, its items and its thread",
    () =>
      Effect.gen(function* () {
        const result = yield* decide({ actor: ADMIN, discardWorkItems: true });
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

  it.effect(
    "a group holding only finished work deletes without the flag, discarding that work",
    () =>
      Effect.gen(function* () {
        const result = yield* decide({
          actor: ADMIN,
          readModel: makeGroupWithFinishedWorkOnly(),
        });

        const events = Array.isArray(result) ? result : [result];

        const deletedItemIds = events.flatMap((event) =>
          event.type === "work-item.deleted" ? [event.payload.workItemId] : [],
        );

        expect(deletedItemIds).toEqual([DONE_ITEM_ID]);
        expect(events.at(-1)?.type).toBe("group.deleted");
      }),
  );
});
