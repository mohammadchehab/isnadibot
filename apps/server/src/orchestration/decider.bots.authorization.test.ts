import * as Predicate from "effect/Predicate";
import {
  AuthSessionId,
  BotId,
  CommandId,
  GroupId,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  makeReadModel,
  makeBot,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  makeGroup,
  PERSON_ID,
  NOW,
  GROUP_ID,
} from "./test-support/GroupDeciderFixtures.ts";

const OTHER_GROUP_ID = GroupId.make("group-other");

const OUTSIDER_ID = AuthSessionId.make("person-outsider");

const createBotCommand = (commandId: string, botId: BotId, groupId: GroupId | null) =>
  ({
    type: "bot.create",
    commandId: CommandId.make(commandId),
    botId,
    name: "New bot",
    title: "Agent",
    avatar: { kind: "dither", seed: botId },
    engine: null,
    sandbox: null,
    imageProvider: null,
    groupId,
    createdAt: NOW,
  }) satisfies OrchestrationCommand;

it.layer(NodeServices.layer)("bot command authorization", (it) => {
  const outsider = { personId: OUTSIDER_ID, canManageGroups: false } as const;

  const member = { personId: PERSON_ID, canManageGroups: false } as const;

  const admin = { personId: AuthSessionId.make("person-admin"), canManageGroups: true } as const;

  const readModel = () =>
    makeReadModel({
      bots: [
        makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
        makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
        makeBot({ id: OTHER_SPECIALIST_ID }),
      ],
      groups: [
        makeGroup({
          members: [
            { kind: "bot", botId: BOSS_ID, role: "boss" },
            { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
            { kind: "person", personId: PERSON_ID, displayName: "Member" },
          ],
        }),
      ],
    });

  it.effect("lets a group member create, edit and archive a bot in their group", () =>
    Effect.gen(function* () {
      const results = yield* Effect.all([
        decideOrchestrationCommand({
          command: {
            type: "bot.update",
            commandId: CommandId.make("cmd-member-update"),
            botId: SPECIALIST_ID,
            title: "Member edited",
          },
          readModel: readModel(),
          actor: member,
        }).pipe(Effect.result),
        decideOrchestrationCommand({
          command: createBotCommand("cmd-member-create", BotId.make("bot-new"), GROUP_ID),
          readModel: readModel(),
          actor: member,
        }).pipe(Effect.result),
        decideOrchestrationCommand({
          command: {
            type: "bot.delete",
            commandId: CommandId.make("cmd-member-delete"),
            botId: SPECIALIST_ID,
          },
          readModel: readModel(),
          actor: member,
        }).pipe(Effect.flip),
      ]);

      expect(results.slice(0, 2).map((result) => result._tag)).toEqual(["Success", "Success"]);

      // Deleting a bot is still refused when the group would drop below two bots.
      const deleteError = results[2];

      if (!Predicate.isTagged(deleteError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected the two-bot floor to refuse the delete");
      }

      expect(deleteError.detail).toContain("requires at least two active bots");
    }),
  );

  it.effect("refuses bot changes from a stranger", () =>
    Effect.gen(function* () {
      const commands: ReadonlyArray<OrchestrationCommand> = [
        {
          type: "bot.update",
          commandId: CommandId.make("cmd-stranger-update"),
          botId: SPECIALIST_ID,
          title: "Stranger edited",
        },
        {
          type: "bot.delete",
          commandId: CommandId.make("cmd-stranger-delete"),
          botId: SPECIALIST_ID,
        },
        createBotCommand("cmd-stranger-create", BotId.make("bot-new"), GROUP_ID),
        {
          type: "bot.update",
          commandId: CommandId.make("cmd-stranger-update-ungrouped"),
          botId: OTHER_SPECIALIST_ID,
          title: "Stranger edited",
        },
      ];

      const errors = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: readModel(), actor: outsider }).pipe(
            Effect.flip,
          ),
        ),
      );

      const details = errors.map((error) => {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected a bot authorization invariant error");
        }

        return error.detail;
      });

      expect(details.slice(0, 3)).toEqual([
        `Person '${OUTSIDER_ID}' is not a member of group '${GROUP_ID}'.`,
        `Person '${OUTSIDER_ID}' is not a member of group '${GROUP_ID}'.`,
        `Person '${OUTSIDER_ID}' is not a member of group '${GROUP_ID}'.`,
      ]);
      expect(details[3]).toBe(
        `Person '${OUTSIDER_ID}' needs 'access:write' to change the environment.`,
      );
    }),
  );

  it.effect("refuses moving a bot into a group the actor has no rights on", () =>
    Effect.gen(function* () {
      const model = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: OTHER_SPECIALIST_ID }),
        ],
        groups: [
          makeGroup(),
          {
            ...makeGroup(),
            id: OTHER_GROUP_ID,
            name: "Other",
            members: [
              { kind: "bot" as const, botId: BOSS_ID, role: "boss" as const },
              { kind: "bot" as const, botId: OTHER_SPECIALIST_ID, role: "specialist" as const },
            ],
          },
        ],
      });

      const error = yield* decideOrchestrationCommand({
        command: {
          type: "bot.update",
          commandId: CommandId.make("cmd-member-move"),
          botId: SPECIALIST_ID,
          groupId: OTHER_GROUP_ID,
        },
        readModel: model,
        actor: member,
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected a target-group authorization invariant error");
      }

      expect(error.detail).toContain(`Person '${PERSON_ID}' is not a member`);
    }),
  );

  it.effect("refuses bot changes from a person who is only in another group", () =>
    Effect.gen(function* () {
      const otherGroupOwnerId = AuthSessionId.make("person-other-group");
      const otherGroupOwner = { personId: otherGroupOwnerId, canManageGroups: false } as const;

      const model = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: OTHER_SPECIALIST_ID, groupId: OTHER_GROUP_ID }),
        ],
        groups: [
          makeGroup(),
          {
            ...makeGroup(),
            id: OTHER_GROUP_ID,
            name: "Other",
            bossBotId: OTHER_SPECIALIST_ID,
            members: [
              { kind: "bot" as const, botId: OTHER_SPECIALIST_ID, role: "boss" as const },
              { kind: "person" as const, personId: otherGroupOwnerId, displayName: "Other owner" },
            ],
          },
        ],
      });

      const commands: ReadonlyArray<OrchestrationCommand> = [
        {
          type: "bot.update",
          commandId: CommandId.make("cmd-other-owner-update"),
          botId: SPECIALIST_ID,
          title: "Other group's owner edited",
        },
        {
          type: "bot.archive",
          commandId: CommandId.make("cmd-other-owner-archive"),
          botId: SPECIALIST_ID,
        },
        {
          type: "bot.delete",
          commandId: CommandId.make("cmd-other-owner-delete"),
          botId: SPECIALIST_ID,
        },
      ];

      const errors = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: model, actor: otherGroupOwner }).pipe(
            Effect.flip,
          ),
        ),
      );

      for (const error of errors) {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected a group authorization invariant error");
        }

        expect(error.detail).toContain(`Person '${otherGroupOwnerId}' is not a member`);
      }
    }),
  );

  it.effect("keeps group-less bots to environment manage rights", () =>
    Effect.gen(function* () {
      const commands: ReadonlyArray<OrchestrationCommand> = [
        createBotCommand("cmd-create-ungrouped", BotId.make("bot-new"), null),
        {
          type: "bot.update",
          commandId: CommandId.make("cmd-member-update-ungrouped"),
          botId: OTHER_SPECIALIST_ID,
          title: "Member edited",
        },
      ];

      const memberErrors = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: readModel(), actor: member }).pipe(
            Effect.flip,
          ),
        ),
      );

      for (const error of memberErrors) {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected an environment authorization invariant error");
        }

        expect(error.detail).toContain(`Person '${PERSON_ID}' needs 'access:write'`);
      }

      const adminResults = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: readModel(), actor: admin }).pipe(
            Effect.result,
          ),
        ),
      );

      expect(adminResults.map((result) => result._tag)).toEqual(["Success", "Success"]);
    }),
  );

  it.effect("keeps trusted internal bot dispatches actorless", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: createBotCommand("cmd-internal-create", BotId.make("bot-fleet-member"), GROUP_ID),
        readModel: readModel(),
      });

      const events = Array.isArray(result) ? result : [result];

      expect(events.map((event) => event.type)).toEqual(["group.member-assigned", "bot.created"]);
    }),
  );
});
