import * as Predicate from "effect/Predicate";
import { AuthSessionId, CommandId, GroupId, type OrchestrationCommand } from "@isnadi/contracts";
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

it.layer(NodeServices.layer)("group membership authorization", (it) => {
  const outsider = {
    personId: AuthSessionId.make("person-outsider"),
    canManageGroups: false,
  } as const;

  const member = { personId: PERSON_ID, canManageGroups: false } as const;

  const admin = { personId: AuthSessionId.make("person-admin"), canManageGroups: true } as const;

  const groupReadModel = () =>
    makeReadModel({
      bots: [
        makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
        makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
        makeBot({ id: OTHER_SPECIALIST_ID, groupId: GROUP_ID }),
      ],
      groups: [
        makeGroup({
          members: [
            { kind: "bot", botId: BOSS_ID, role: "boss" },
            { kind: "bot", botId: SPECIALIST_ID, role: "specialist" },
            { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
            { kind: "person", personId: PERSON_ID, displayName: "Member" },
          ],
        }),
      ],
    });

  const groupConfigCommands: ReadonlyArray<OrchestrationCommand> = [
    {
      type: "group.rename",
      commandId: CommandId.make("cmd-config-rename"),
      groupId: GROUP_ID,
      name: "Renamed",
    },
    {
      type: "group.keep-busy.set",
      commandId: CommandId.make("cmd-config-keep-busy"),
      groupId: GROUP_ID,
      keepBusy: true,
    },
    {
      type: "group.delete",
      commandId: CommandId.make("cmd-config-delete"),
      groupId: GROUP_ID,
    },
    {
      type: "group.member.assign",
      commandId: CommandId.make("cmd-config-member-assign"),
      groupId: GROUP_ID,
      botId: OTHER_SPECIALIST_ID,
      role: "specialist",
    },
    {
      type: "group.member.unassign",
      commandId: CommandId.make("cmd-config-member-unassign"),
      groupId: GROUP_ID,
      botId: SPECIALIST_ID,
    },
    {
      type: "group.boss.set",
      commandId: CommandId.make("cmd-config-boss-set"),
      groupId: GROUP_ID,
      bossBotId: SPECIALIST_ID,
    },
  ];

  it.effect("lets a group member configure their group", () =>
    Effect.gen(function* () {
      const results = yield* Effect.all(
        groupConfigCommands.map((command) =>
          decideOrchestrationCommand({ command, readModel: groupReadModel(), actor: member }).pipe(
            Effect.result,
          ),
        ),
      );

      expect(results.map((result) => result._tag)).toEqual([
        "Success",
        "Success",
        "Success",
        "Success",
        "Success",
        "Success",
      ]);
    }),
  );

  it.effect("refuses group configuration from a stranger", () =>
    Effect.gen(function* () {
      const errors = yield* Effect.all(
        groupConfigCommands.map((command) =>
          decideOrchestrationCommand({
            command,
            readModel: groupReadModel(),
            actor: outsider,
          }).pipe(Effect.flip),
        ),
      );

      for (const error of errors) {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected a group authorization invariant error");
        }

        expect(error.detail).toContain(`Person '${outsider.personId}' is not a member`);
      }
    }),
  );

  it.effect("refuses group configuration from a person who is only in another group", () =>
    Effect.gen(function* () {
      const otherGroupId = GroupId.make("group-other");
      const otherGroupOwnerId = AuthSessionId.make("person-other-group");
      const otherGroupOwner = { personId: otherGroupOwnerId, canManageGroups: false } as const;

      const model = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: OTHER_SPECIALIST_ID, groupId: otherGroupId }),
        ],
        groups: [
          makeGroup(),
          {
            ...makeGroup(),
            id: otherGroupId,
            name: "Other",
            bossBotId: OTHER_SPECIALIST_ID,
            members: [
              { kind: "bot" as const, botId: OTHER_SPECIALIST_ID, role: "boss" as const },
              { kind: "person" as const, personId: otherGroupOwnerId, displayName: "Other owner" },
            ],
          },
        ],
      });

      const errors = yield* Effect.all(
        groupConfigCommands.map((command) =>
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

  it.effect("refuses pulling another group's bot into a group you only have rights over", () =>
    Effect.gen(function* () {
      const otherGroupId = GroupId.make("group-other");
      const otherGroupOwnerId = AuthSessionId.make("person-other-group");

      const model = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: OTHER_SPECIALIST_ID, groupId: otherGroupId }),
        ],
        groups: [
          makeGroup(),
          {
            ...makeGroup(),
            id: otherGroupId,
            name: "Other",
            bossBotId: OTHER_SPECIALIST_ID,
            members: [
              { kind: "bot" as const, botId: OTHER_SPECIALIST_ID, role: "boss" as const },
              { kind: "person" as const, personId: otherGroupOwnerId, displayName: "Other owner" },
            ],
          },
        ],
      });

      const assignCommand: OrchestrationCommand = {
        type: "group.member.assign",
        commandId: CommandId.make("cmd-steal-member"),
        groupId: GROUP_ID,
        botId: OTHER_SPECIALIST_ID,
        role: "specialist",
      };

      const memberError = yield* decideOrchestrationCommand({
        command: assignCommand,
        readModel: model,
        actor: member,
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(memberError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected a source-group authorization invariant error");
      }

      expect(memberError.detail).toContain(`Person '${PERSON_ID}' is not a member of group`);
      expect(memberError.detail).toContain(otherGroupId);

      const adminResult = yield* decideOrchestrationCommand({
        command: assignCommand,
        readModel: model,
        actor: admin,
      });

      expect("type" in adminResult && adminResult.type).toBe("group.member-assigned");
    }),
  );

  it.effect("refuses adding a group-less bot to a group on group membership alone", () =>
    Effect.gen(function* () {
      // A bot with no group is an environment-level record, not a group's, so being a member of
      // the target group must not reach it: only environment manage rights can put it in a group.
      // `bot.update` moves the same bot under the same rule.
      const model = makeReadModel({
        bots: [
          makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
          makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
          makeBot({ id: OTHER_SPECIALIST_ID }),
        ],
        groups: [makeGroup()],
      });

      const assignCommand: OrchestrationCommand = {
        type: "group.member.assign",
        commandId: CommandId.make("cmd-assign-group-less"),
        groupId: GROUP_ID,
        botId: OTHER_SPECIALIST_ID,
        role: "specialist",
      };

      const memberError = yield* decideOrchestrationCommand({
        command: assignCommand,
        readModel: model,
        actor: member,
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(memberError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected an environment authorization invariant error");
      }

      expect(memberError.detail).toContain(`Person '${PERSON_ID}' needs 'access:write'`);

      const adminResult = yield* decideOrchestrationCommand({
        command: assignCommand,
        readModel: model,
        actor: admin,
      });

      expect("type" in adminResult && adminResult.type).toBe("group.member-assigned");
    }),
  );

  it.effect("keeps group creation and person membership on environment manage rights", () =>
    Effect.gen(function* () {
      const commands: ReadonlyArray<OrchestrationCommand> = [
        {
          type: "group.create",
          commandId: CommandId.make("cmd-create"),
          groupId: GroupId.make("group-new"),
          name: "New group",
          bossBotId: BOSS_ID,
          specialistBotIds: [SPECIALIST_ID],
          createdAt: NOW,
        },
        {
          type: "group.person.assign",
          commandId: CommandId.make("cmd-person-assign"),
          groupId: GROUP_ID,
          person: {
            kind: "person",
            personId: AuthSessionId.make("person-new"),
            displayName: "New person",
          },
        },
        {
          type: "group.person.unassign",
          commandId: CommandId.make("cmd-person-unassign"),
          groupId: GROUP_ID,
          personId: PERSON_ID,
        },
      ];

      const memberErrors = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: groupReadModel(), actor: member }).pipe(
            Effect.flip,
          ),
        ),
      );

      for (const error of memberErrors) {
        if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
          throw new Error("Expected an environment authorization invariant error");
        }

        expect(error.detail).toContain(`Person '${member.personId}' needs 'access:write'`);
      }

      const adminResults = yield* Effect.all(
        commands.map((command) =>
          decideOrchestrationCommand({ command, readModel: groupReadModel(), actor: admin }).pipe(
            Effect.result,
          ),
        ),
      );

      expect(adminResults.map((result) => result._tag)).toEqual(["Success", "Success", "Success"]);
    }),
  );

  it.effect("lets a person leave a group only as themselves", () =>
    Effect.gen(function* () {
      const command: OrchestrationCommand = {
        type: "group.leave",
        commandId: CommandId.make("cmd-leave"),
        groupId: GROUP_ID,
        personId: PERSON_ID,
      };

      const asSelf = yield* decideOrchestrationCommand({
        command,
        readModel: groupReadModel(),
        actor: member,
      }).pipe(Effect.result);

      const internal = yield* decideOrchestrationCommand({
        command,
        readModel: groupReadModel(),
      }).pipe(Effect.result);

      const asSomeoneElse = yield* decideOrchestrationCommand({
        command,
        readModel: groupReadModel(),
        actor: outsider,
      }).pipe(Effect.flip);

      expect([asSelf._tag, internal._tag]).toEqual(["Success", "Success"]);

      if (!Predicate.isTagged(asSomeoneElse, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected a leave authorization invariant error");
      }

      expect(asSomeoneElse.detail).toContain(`Person '${outsider.personId}' can only leave`);
    }),
  );
});
