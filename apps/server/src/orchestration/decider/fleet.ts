import {
  FLEET_TEMPLATES,
  GroupId,
  BotId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  fleetRole,
} from "@isnadi/contracts";
import { planFleetHire } from "@isnadi/shared/fleet";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import { requireEnvironmentManageRights } from "../commandInvariants.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import type { DecideCommandSequence, DecideOrchestrationCommandResult } from "./eventBase.ts";

/**
 * Hiring a fleet is one command that decides many events. It reuses
 * `decideCommandSequence` on the `bot.create` and `group.create` commands it
 * builds, so a hired member is created exactly the way a hand-made bot is and
 * the shared command invariants (no duplicate bot, active boss, two members)
 * still run. Every event carries the one `commandId`, so the hire lands or
 * fails as a unit and emits a single receipt.
 *
 * The decider is pure and replays deterministically, so it cannot read which
 * providers the environment has: the client resolves engines with `fleet.plan`
 * and sends them back as `picks`. A role without a pick is a `no-provider`
 * blocker and refuses the whole hire.
 */
export const decideFleet = Effect.fn("decideFleet")(function* ({
  command,
  readModel,
  actor,
  decideCommandSequence,
}: {
  readonly command: Extract<OrchestrationCommand, { type: "fleet.hire" }>;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
  readonly decideCommandSequence: DecideCommandSequence;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "fleet.hire": {
      // A hire changes the environment's roster, so it needs the same rights
      // `bot.create` and `group.create` do. An internal dispatch carries no
      // actor and stays allowed.
      yield* requireEnvironmentManageRights({ command, actor });

      const template = FLEET_TEMPLATES[command.templateIndex];

      if (template === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `No fleet template at index ${command.templateIndex}.`,
        });
      }

      const bossRoleId = command.bossRoleId ?? template.bossRoleId;

      if (!template.roleIds.includes(bossRoleId)) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Role '${bossRoleId}' is not part of template '${template.id}'.`,
        });
      }

      const plan = planFleetHire({
        template: { ...template, bossRoleId },
        providers: [],
        picks: command.picks,
        names: new Map((command.names ?? []).map((entry) => [entry.roleId, entry.name])),
      });

      if (plan.blockers.length > 0) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `The hire is blocked: ${plan.blockers
            .map((blocker) => (blocker.kind === "duplicate-name" ? blocker.kind : blocker.roleId))
            .join(", ")}.`,
        });
      }

      // A template only names roles in the catalogue, so this drops nothing;
      // it narrows the lookup so the avatar below is always a real role's.
      const membersWithRoles = plan.members.flatMap((member) => {
        const role = fleetRole(member.roleId);

        return role === undefined ? [] : [{ member, role }];
      });

      if (membersWithRoles.length !== plan.members.length) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Template '${template.id}' names a role that is not in the fleet catalogue.`,
        });
      }

      // The server mints every id: a client cannot name one that persists.
      const crypto = yield* Crypto.Crypto;

      const groupId = GroupId.make(yield* crypto.randomUUIDv4);

      // Minting alongside the member it belongs to keeps the bot id, its role
      // and the group's member list from drifting apart by index.
      const squad = yield* Effect.forEach(membersWithRoles, ({ member, role }) =>
        Effect.map(crypto.randomUUIDv4, (uuid) => ({ member, role, botId: BotId.make(uuid) })),
      );

      const bossBotId = squad.find((entry) => entry.member.isBoss)?.botId;

      if (bossBotId === undefined) {
        return yield* new OrchestrationCommandInvariantError({
          commandType: command.type,
          detail: `Template '${template.id}' names no boss member.`,
        });
      }

      const specialistBotIds = squad
        .filter((entry) => entry.botId !== bossBotId)
        .map((entry) => entry.botId);

      const botCommands = squad.map(
        ({ member, role, botId }): Extract<OrchestrationCommand, { type: "bot.create" }> => ({
          type: "bot.create",
          commandId: command.commandId,
          botId,
          name: member.name,
          title: member.title,
          description: member.description,
          skills: member.skills,
          avatar: role.avatar,
          engine: member.engine,
          sandbox: null,
          roleId: member.roleId,
          groupId,
          createdAt: command.createdAt,
        }),
      );

      const groupCommand: Extract<OrchestrationCommand, { type: "group.create" }> = {
        type: "group.create",
        commandId: command.commandId,
        groupId,
        name: command.groupName ?? template.name,
        bossBotId,
        specialistBotIds,
        keepBusy: true,
        fleetTemplateId: template.id,
        ...(command.hopBudget === undefined ? {} : { hopBudget: command.hopBudget }),
        createdAt: command.createdAt,
      };

      return yield* decideCommandSequence({
        readModel,
        ...(actor !== undefined ? { actor } : {}),
        plannedGroupIds: [groupId],
        commands: [...botCommands, groupCommand],
      });
    }
  }
});
