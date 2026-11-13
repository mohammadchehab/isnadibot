import {
  CommandId,
  GroupId,
  WorkItemId,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkItem,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  OTHER_SPECIALIST_ID,
  PERSON_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "./test-support/GroupDeciderFixtures.ts";

const THREAD_ID = makeGroupThread().id;

const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: WorkItemId.make("item-1"),
  groupId: GROUP_ID,
  title: "Fix the thing",
  brief: "It is broken.",
  kind: "task",
  state: "in-progress",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/** Three bots, so removing one leaves the two the group requires. */
const makeThreeBotGroup = (overrides: { readonly bossBotId?: OrchestrationBot["id"] } = {}) =>
  makeGroup({
    ...(overrides.bossBotId !== undefined ? { bossBotId: overrides.bossBotId } : {}),
    members: [
      { kind: "bot", botId: BOSS_ID, role: "boss" },
      { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
      { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
      { kind: "person", personId: PERSON_ID, displayName: "Member" },
    ],
  });

const makeModel = (input: {
  readonly items: ReadonlyArray<WorkItem>;
  readonly bots?: ReadonlyArray<OrchestrationBot>;
  readonly groups?: ReadonlyArray<OrchestrationGroup>;
  readonly threads?: ReadonlyArray<OrchestrationThread>;
}): OrchestrationReadModel => ({
  ...makeReadModel({
    bots:
      input.bots ??
      [BOSS_ID, SPECIALIST_ID, OTHER_SPECIALIST_ID].map((id) => makeBot({ id, groupId: GROUP_ID })),
    groups: input.groups ?? [makeThreeBotGroup()],
    threads: input.threads ?? [makeGroupThread()],
  }),
  workItems: input.items,
});

const decide = (command: OrchestrationCommand, readModel: OrchestrationReadModel) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({ command, readModel });

    return Array.isArray(result) ? result : [result];
  });

const types = (events: ReadonlyArray<OrchestrationEvent>) => events.map((event) => event.type);

const releasedItems = (events: ReadonlyArray<OrchestrationEvent>): ReadonlyArray<WorkItem> =>
  events.flatMap((event) =>
    event.type === "work-item.assigned" && "workItem" in event.payload
      ? [event.payload.workItem]
      : [],
  );

const systemLines = (events: ReadonlyArray<OrchestrationEvent>) =>
  events.flatMap((event) =>
    event.type === "thread.message-sent" && event.payload.role === "system" ? [event.payload] : [],
  );

it.layer(NodeServices.layer)("work item owner cascade", (it) => {
  it.effect("unassigning a member releases the open items it owned in that group", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign"),
          groupId: GROUP_ID,
          botId: SPECIALIST_ID,
        },
        makeModel({
          items: [
            makeItem({
              ownerBotId: SPECIALIST_ID,
              assignedByBotId: BOSS_ID,
              state: "blocked",
              blockedFrom: "in-progress",
              blockedOn: { by: "bot", botId: SPECIALIST_ID, note: "Waiting on the API" },
              threadId: THREAD_ID,
            }),
          ],
        }),
      );

      expect(types(events)).toEqual([
        "group.member-unassigned",
        "work-item.assigned",
        "thread.message-sent",
      ]);

      const [released] = releasedItems(events);

      expect(released?.state).toBe("queued");
      expect(released?.ownerBotId).toBeUndefined();
      expect(released?.assignedByBotId).toBeUndefined();
      expect(released?.blockedFrom).toBeUndefined();
      expect(released?.blockedOn).toBeUndefined();

      const [line] = systemLines(events);

      expect(line?.threadId).toBe(THREAD_ID);
      expect(line?.messageId).toBe(`work-item-owner-cleared:item-1`);
      expect(line?.text).toContain(SPECIALIST_ID);
      expect(line?.text).toContain("Fix the thing");
    }),
  );

  it.effect("leaves the items the bot owned in other groups alone", () =>
    Effect.gen(function* () {
      const otherGroupId = GroupId.make("group-other");

      const events = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign-scoped"),
          groupId: GROUP_ID,
          botId: SPECIALIST_ID,
        },
        makeModel({
          items: [makeItem({ groupId: otherGroupId, ownerBotId: SPECIALIST_ID })],
        }),
      );

      expect(types(events)).toEqual(["group.member-unassigned"]);
    }),
  );

  it.effect("moving a bot out of a group releases the items it owned there", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "bot.update",
          commandId: CommandId.make("cmd-update-group"),
          botId: SPECIALIST_ID,
          groupId: null,
        },
        makeModel({ items: [makeItem({ ownerBotId: SPECIALIST_ID, threadId: THREAD_ID })] }),
      );

      expect(types(events)).toEqual([
        "group.member-unassigned",
        "work-item.assigned",
        "thread.message-sent",
        "bot.updated",
      ]);
      expect(releasedItems(events)[0]?.state).toBe("queued");
    }),
  );

  it.effect("archiving a bot releases every open item it owns", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "bot.archive",
          commandId: CommandId.make("cmd-archive"),
          botId: SPECIALIST_ID,
        },
        makeModel({ items: [makeItem({ ownerBotId: SPECIALIST_ID, threadId: THREAD_ID })] }),
      );

      expect(types(events)).toEqual(["work-item.assigned", "thread.message-sent", "bot.archived"]);
      expect(releasedItems(events)[0]?.state).toBe("queued");
      expect(systemLines(events)).toHaveLength(1);
    }),
  );

  it.effect("deleting a bot releases every open item it owns", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "bot.delete",
          commandId: CommandId.make("cmd-delete"),
          botId: SPECIALIST_ID,
        },
        makeModel({
          bots: [BOSS_ID, SPECIALIST_ID, OTHER_SPECIALIST_ID].map((id) =>
            makeBot({
              id,
              groupId: GROUP_ID,
              ...(id === SPECIALIST_ID ? { archivedAt: NOW } : {}),
            }),
          ),
          items: [makeItem({ ownerBotId: SPECIALIST_ID, threadId: THREAD_ID })],
        }),
      );

      expect(types(events)).toContain("bot.deleted");
      expect(releasedItems(events)).toHaveLength(1);
      expect(releasedItems(events)[0]?.state).toBe("queued");
      expect(systemLines(events)).toHaveLength(1);
    }),
  );

  it.effect("finished items keep their owner and post nothing", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "bot.archive",
          commandId: CommandId.make("cmd-archive-finished"),
          botId: SPECIALIST_ID,
        },
        makeModel({
          items: [
            makeItem({
              id: WorkItemId.make("item-done"),
              ownerBotId: SPECIALIST_ID,
              state: "done",
            }),
            makeItem({
              id: WorkItemId.make("item-closed"),
              ownerBotId: SPECIALIST_ID,
              state: "closed",
            }),
          ],
        }),
      );

      expect(types(events)).toEqual(["bot.archived"]);
    }),
  );

  it.effect("releases an item with no chat silently", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign-no-thread"),
          groupId: GROUP_ID,
          botId: SPECIALIST_ID,
        },
        makeModel({ items: [makeItem({ ownerBotId: SPECIALIST_ID })] }),
      );

      expect(types(events)).toEqual(["group.member-unassigned", "work-item.assigned"]);
    }),
  );
});
