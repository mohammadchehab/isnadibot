import * as Predicate from "effect/Predicate";
import {
  BotId,
  CommandId,
  GroupId,
  WorkItemId,
  type OrchestrationReadModel,
  type WorkItem,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  GROUP_ID,
  makeReadModel,
  BOSS_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  OTHER_SPECIALIST_ID,
  applyCommand,
  NOW,
} from "./test-support/GroupDeciderFixtures.ts";

const SALES_ID = GroupId.make("group-sales");

const SALES_BOSS_ID = BotId.make("bot-sales-boss");

/**
 * Two groups, each able to spare a bot: Product keeps BOSS_ID and
 * OTHER_SPECIALIST_ID after SPECIALIST_ID leaves, and Sales has a boss of its
 * own. SPECIALIST_ID sits in Product, which is where every move starts.
 */
function twoGroups(input: { readonly specialistGroupId?: GroupId | null } = {}) {
  const specialistGroupId =
    input.specialistGroupId === undefined ? GROUP_ID : input.specialistGroupId;

  return makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({
        id: SPECIALIST_ID,
        ...(specialistGroupId === null ? {} : { groupId: specialistGroupId }),
      }),
      makeBot({ id: OTHER_SPECIALIST_ID, groupId: GROUP_ID }),
      makeBot({ id: SALES_BOSS_ID, groupId: SALES_ID }),
    ],
    groups: [
      makeGroup({
        members: [
          { kind: "bot", botId: BOSS_ID, role: "boss" },
          { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
          { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
        ],
      }),
      makeGroup({
        id: SALES_ID,
        name: "Sales",
        bossBotId: SALES_BOSS_ID,
        members: [{ kind: "bot", botId: SALES_BOSS_ID, role: "boss" }],
      }),
    ],
  });
}

const moveCommand = (input: {
  readonly groupId?: GroupId;
  readonly role?: "boss" | "specialist";
}) => ({
  type: "group.member.assign" as const,
  commandId: CommandId.make("cmd-move-bot"),
  groupId: input.groupId ?? SALES_ID,
  botId: SPECIALIST_ID,
  role: input.role ?? "specialist",
});

const groupState = (model: OrchestrationReadModel, groupId: GroupId) =>
  model.groups.find((group) => group.id === groupId);

const botBotIds = (model: OrchestrationReadModel, groupId: GroupId): ReadonlyArray<string> =>
  (groupState(model, groupId)?.members ?? [])
    .filter((member) => member.kind === "bot")
    .map((member) => member.botId);

it.layer(NodeServices.layer)("moving a bot between groups", (it) => {
  it.effect("leaves the source group before it joins the target", () =>
    Effect.gen(function* () {
      // TASK-246: assigning a bot that already lives elsewhere used to add it to
      // the second group and leave the first one's roster and its own groupId
      // naming the old group. A move is one move.
      const result = yield* decideOrchestrationCommand({
        command: moveCommand({}),
        readModel: twoGroups(),
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "group.member-unassigned",
        "bot.updated",
        "group.member-assigned",
      ]);

      const unassigned = events[0];
      const updated = events[1];
      const assigned = events[2];

      if (unassigned?.type !== "group.member-unassigned") {
        throw new Error("Expected group.member-unassigned");
      }

      if (updated?.type !== "bot.updated") {
        throw new Error("Expected bot.updated");
      }

      if (assigned?.type !== "group.member-assigned") {
        throw new Error("Expected group.member-assigned");
      }

      expect(unassigned.payload).toMatchObject({ groupId: GROUP_ID, botId: SPECIALIST_ID });
      expect(updated.payload).toMatchObject({ botId: SPECIALIST_ID, groupId: SALES_ID });
      expect(assigned.payload).toMatchObject({
        groupId: SALES_ID,
        member: { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
      });
    }),
  );

  it.effect("releases the items the bot owned in the group it leaves", () =>
    Effect.gen(function* () {
      // TASK-259: a bot that moved to another group kept its open items assigned
      // to it in the group it left, where nobody could pick them up. The release
      // lands in the same transaction as the departure, before the bot's own row
      // moves, so no reader sees the item owned by a bot that already left.
      const item: WorkItem = {
        id: WorkItemId.make("item-source"),
        groupId: GROUP_ID,
        title: "Source item",
        brief: "Owned by the specialist before the move.",
        kind: "task",
        ownerBotId: SPECIALIST_ID,
        state: "assigned",
        createdAt: NOW,
        updatedAt: NOW,
      };

      const result = yield* decideOrchestrationCommand({
        command: moveCommand({}),
        readModel: { ...twoGroups(), workItems: [item] },
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "group.member-unassigned",
        "work-item.assigned",
        "bot.updated",
        "group.member-assigned",
      ]);

      const released = events[1];

      if (released?.type !== "work-item.assigned") {
        throw new Error("Expected work-item.assigned");
      }

      // The item waits in the group it belongs to: it does not follow the bot.
      expect(released.payload.workItem).toMatchObject({
        id: item.id,
        groupId: GROUP_ID,
        state: "queued",
      });
      expect(released.payload.workItem.ownerBotId).toBeUndefined();
    }),
  );

  it.effect("leaves the source group without the bot and the target with it", () =>
    Effect.gen(function* () {
      const { readModel } = yield* applyCommand(twoGroups(), moveCommand({}));

      expect(botBotIds(readModel, GROUP_ID)).toEqual([BOSS_ID, OTHER_SPECIALIST_ID]);
      expect(botBotIds(readModel, SALES_ID)).toEqual([SALES_BOSS_ID, SPECIALIST_ID]);
      expect(readModel.bots.find((bot) => bot.id === SPECIALIST_ID)?.groupId).toBe(SALES_ID);
    }),
  );

  it.effect("refuses to move a group's boss", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "group.member.assign",
          commandId: CommandId.make("cmd-move-boss"),
          groupId: SALES_ID,
          botId: BOSS_ID,
          role: "specialist",
        },
        readModel: twoGroups(),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected an orchestration command invariant error");
      }

      expect(error.detail).toContain("is the boss of group");
    }),
  );

  it.effect("refuses to leave a group with fewer than two active bots", () =>
    Effect.gen(function* () {
      // A group of two bots keeps both: taking one out would leave a group of
      // one, which every other way out of a group already refuses.
      const error = yield* decideOrchestrationCommand({
        command: moveCommand({}),
        readModel: makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
            makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
            makeBot({ id: SALES_BOSS_ID, groupId: SALES_ID }),
          ],
          groups: [
            makeGroup({
              members: [
                { kind: "bot", botId: BOSS_ID, role: "boss" },
                { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
              ],
            }),
            makeGroup({
              id: SALES_ID,
              name: "Sales",
              bossBotId: SALES_BOSS_ID,
              members: [{ kind: "bot", botId: SALES_BOSS_ID, role: "boss" }],
            }),
          ],
        }),
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected an orchestration command invariant error");
      }

      expect(error.detail).toContain("at least two active bots");
      expect(error.detail).toContain(GROUP_ID);
    }),
  );

  it.effect("moves a bot that belongs to no group with the assignment it always had", () =>
    Effect.gen(function* () {
      // The other half of the defect: a group-less bot joined a group's roster
      // while its own groupId stayed null, so the roster and the row disagreed.
      const result = yield* decideOrchestrationCommand({
        command: moveCommand({ groupId: GROUP_ID }),
        readModel: twoGroups({ specialistGroupId: null }),
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["bot.updated", "group.member-assigned"]);

      const updated = events[0];

      if (updated?.type !== "bot.updated") throw new Error("Expected bot.updated");
      expect(updated.payload).toMatchObject({ botId: SPECIALIST_ID, groupId: GROUP_ID });
    }),
  );

  it.effect("is a plain assignment when the bot already belongs to that group", () =>
    Effect.gen(function* () {
      // A second assignment inside one group touches that group only: no
      // departure to record and no groupId to write.
      const result = yield* decideOrchestrationCommand({
        command: moveCommand({ groupId: GROUP_ID }),
        readModel: twoGroups(),
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["group.member-assigned"]);
    }),
  );

  it.effect("moves a bot the source roster no longer lists", () =>
    Effect.gen(function* () {
      // The bot's row names Product but Product's roster does not list it, so
      // there is no membership to remove and no group floor to enforce. The
      // departure still records that the row and the roster now agree.
      const readModel = twoGroups();

      const result = yield* decideOrchestrationCommand({
        command: moveCommand({}),
        readModel: {
          ...readModel,
          groups: readModel.groups.map((group) =>
            group.id === GROUP_ID
              ? {
                  ...group,
                  members: group.members.filter(
                    (member) => member.kind !== "bot" || member.botId !== SPECIALIST_ID,
                  ),
                }
              : group,
          ),
        },
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual([
        "group.member-unassigned",
        "bot.updated",
        "group.member-assigned",
      ]);
    }),
  );
});
