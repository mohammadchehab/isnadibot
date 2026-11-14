import { BotId, CommandId, EventId, GroupId, WorkItemId } from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { OrchestrationEventStore } from "../../persistence/Services/OrchestrationEventStore.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { makeProjectionPipelinePrefixedTestLayer } from "./test-support/ProjectionPipelineHarness.ts";

// A bot moving between groups is three events: the source roster drops it, its own `groupId`
// follows, the target roster takes it. The two roster handlers and the bot handler already
// exist, so this pins that replaying the plan in order leaves both rosters and the bot row
// agreeing — no projection code of its own.
it.layer(Layer.fresh(makeProjectionPipelinePrefixedTestLayer("t3-projection-group-move-")))(
  "OrchestrationProjectionPipeline",
  (it) => {
    it.effect("replays a bot moving from one group to another without listing it twice", () =>
      Effect.gen(function* () {
        const projectionPipeline = yield* OrchestrationProjectionPipeline;
        const eventStore = yield* OrchestrationEventStore;
        const sql = yield* SqlClient.SqlClient;

        const now = "2026-01-01T00:00:00.000Z";
        const sourceGroupId = GroupId.make("group-source");
        const targetGroupId = GroupId.make("group-target");
        const moverId = BotId.make("bot-mover");
        const sourceItemId = WorkItemId.make("item-in-source");
        const targetItemId = WorkItemId.make("item-in-target");

        const appendGroupCreated = (
          index: number,
          groupId: GroupId,
          name: string,
          bossBotId: BotId,
          members: ReadonlyArray<{
            readonly kind: "bot";
            readonly botId: BotId;
            readonly role: "boss" | "specialist";
          }>,
        ) =>
          eventStore
            .append({
              type: "group.created",
              eventId: EventId.make(`evt-${index}`),
              aggregateKind: "group",
              aggregateId: groupId,
              occurredAt: now,
              commandId: CommandId.make(`cmd-${index}`),
              causationEventId: null,
              correlationId: CommandId.make(`cmd-${index}`),
              metadata: {},
              payload: {
                groupId,
                name,
                bossBotId,
                members,
                keepBusy: false,
                fleetTemplateId: null,
                createdAt: now,
                updatedAt: now,
              },
            })
            .pipe(Effect.flatMap(projectionPipeline.projectEvent));

        yield* appendGroupCreated(1, sourceGroupId, "Source", BotId.make("bot-source-boss"), [
          { kind: "bot", botId: BotId.make("bot-source-boss"), role: "boss" },
          { kind: "bot", botId: moverId, role: "specialist" },
          { kind: "bot", botId: BotId.make("bot-source-third"), role: "specialist" },
        ]);
        yield* appendGroupCreated(2, targetGroupId, "Target", BotId.make("bot-target-boss"), [
          { kind: "bot", botId: BotId.make("bot-target-boss"), role: "boss" },
        ]);

        yield* eventStore
          .append({
            type: "bot.created",
            eventId: EventId.make("evt-3"),
            aggregateKind: "bot",
            aggregateId: moverId,
            occurredAt: now,
            commandId: CommandId.make("cmd-3"),
            causationEventId: null,
            correlationId: CommandId.make("cmd-3"),
            metadata: {},
            payload: {
              botId: moverId,
              name: "Mover",
              title: "Specialist",
              skills: [],
              skillRegistryAccess: false,
              avatar: { kind: "dither", seed: "mover" },
              engine: null,
              sandbox: "local",
              groupId: sourceGroupId,
              createdAt: now,
              updatedAt: now,
            },
          })
          .pipe(Effect.flatMap(projectionPipeline.projectEvent));

        // The mover owns one open item in the group it is leaving and one in the group it joins:
        // the departure releases only the first.
        const sourceItem = {
          id: sourceItemId,
          groupId: sourceGroupId,
          title: "Source item",
          brief: "Owned by the mover before it left.",
          kind: "task" as const,
          ownerBotId: moverId,
          state: "assigned" as const,
          createdAt: now,
          updatedAt: now,
        };

        const targetItem = {
          ...sourceItem,
          id: targetItemId,
          groupId: targetGroupId,
          title: "Target item",
        };

        const appendWorkItem = (index: number, workItem: typeof sourceItem | typeof targetItem) =>
          eventStore
            .append({
              type: "work-item.created",
              eventId: EventId.make(`evt-item-${index}`),
              aggregateKind: "work-item",
              aggregateId: workItem.id,
              occurredAt: now,
              commandId: CommandId.make(`cmd-item-${index}`),
              causationEventId: null,
              correlationId: CommandId.make(`cmd-item-${index}`),
              metadata: {},
              payload: { workItem },
            })
            .pipe(Effect.flatMap(projectionPipeline.projectEvent));

        yield* appendWorkItem(4, sourceItem);
        yield* appendWorkItem(5, targetItem);

        // The decider's plan for `group.member.assign` across a group boundary, in order.
        const appendMove = Effect.forEach(
          [
            {
              type: "group.member-unassigned" as const,
              aggregateKind: "group" as const,
              aggregateId: sourceGroupId,
              payload: { groupId: sourceGroupId, botId: moverId, updatedAt: now },
            },
            {
              // TASK-259: leaving the group releases what the bot owned there, and only there.
              type: "work-item.assigned" as const,
              aggregateKind: "work-item" as const,
              aggregateId: sourceItemId,
              payload: {
                workItem: {
                  id: sourceItemId,
                  groupId: sourceGroupId,
                  title: "Source item",
                  brief: "Owned by the mover before it left.",
                  kind: "task" as const,
                  state: "queued" as const,
                  createdAt: now,
                  updatedAt: now,
                },
              },
            },
            {
              type: "bot.updated" as const,
              aggregateKind: "bot" as const,
              aggregateId: moverId,
              payload: { botId: moverId, groupId: targetGroupId, updatedAt: now },
            },
            {
              type: "group.member-assigned" as const,
              aggregateKind: "group" as const,
              aggregateId: targetGroupId,
              payload: {
                groupId: targetGroupId,
                member: { kind: "bot" as const, botId: moverId, role: "specialist" as const },
                updatedAt: now,
              },
            },
          ],
          (event, index) =>
            eventStore
              .append({
                ...event,
                eventId: EventId.make(`evt-move-${index}`),
                occurredAt: now,
                commandId: CommandId.make("cmd-move"),
                causationEventId: null,
                correlationId: CommandId.make("cmd-move"),
                metadata: {},
              })
              .pipe(Effect.flatMap(projectionPipeline.projectEvent)),
        );

        yield* appendMove;

        const groups = yield* sql<{ readonly groupId: string; readonly membersJson: string }>`
          SELECT
            group_id AS "groupId",
            members_json AS "membersJson"
          FROM projection_groups
          ORDER BY group_id
        `;

        const membersOf = (groupId: string) => {
          const row = groups.find((group) => group.groupId === groupId);

          if (row === undefined) throw new Error(`no projection row for ${groupId}`);

          return (JSON.parse(row.membersJson) as ReadonlyArray<{ readonly botId?: string }>).map(
            (member) => member.botId,
          );
        };

        assert.deepEqual(membersOf(sourceGroupId), ["bot-source-boss", "bot-source-third"]);
        assert.deepEqual(membersOf(targetGroupId), ["bot-target-boss", moverId]);

        const bots = yield* sql<{ readonly botId: string; readonly groupId: string | null }>`
          SELECT
            bot_id AS "botId",
            group_id AS "groupId"
          FROM projection_bots
          WHERE bot_id = ${moverId}
        `;

        assert.deepEqual(bots, [{ botId: moverId, groupId: targetGroupId }]);

        // TASK-259: the item the mover owned in the group it left is back in that group's queue,
        // ownerless — it waits where it belongs, it does not follow the bot.
        const items = yield* sql<{ readonly workItemId: string; readonly recordJson: string }>`
          SELECT
            work_item_id AS "workItemId",
            record_json AS "recordJson"
          FROM projection_work_items
          ORDER BY work_item_id
        `;

        const itemOf = (workItemId: string) => {
          const row = items.find((item) => item.workItemId === workItemId);

          if (row === undefined) throw new Error(`no projection row for ${workItemId}`);

          return JSON.parse(row.recordJson) as {
            readonly state: string;
            readonly groupId: string;
            readonly ownerBotId?: string;
          };
        };

        const released = itemOf(sourceItemId);

        assert.strictEqual(released.state, "queued");
        assert.strictEqual(released.ownerBotId, undefined);
        assert.strictEqual(released.groupId, sourceGroupId);

        // The item it owns in the group it joined is untouched: the release is scoped to the source.
        const kept = itemOf(targetItemId);

        assert.strictEqual(kept.state, "assigned");
        assert.strictEqual(kept.ownerBotId, moverId);
        assert.strictEqual(kept.groupId, targetGroupId);
      }),
    );
  },
);
