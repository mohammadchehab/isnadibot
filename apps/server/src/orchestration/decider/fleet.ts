import {
  FLEET_TEMPLATES,
  GroupId,
  BotId,
  type CommandRefusal,
  type FleetHireBlocker,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  fleetRole,
} from "@isnadi/contracts";
import { planFleetHire } from "@isnadi/shared/fleet";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import {
  OrchestrationCommandInvariantError,
  internalInvariantError,
  refusedInvariantError,
} from "../Errors.ts";
import { requireEnvironmentManageRights } from "../commandInvariants.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import type { DecideCommandSequence, DecideOrchestrationCommandResult } from "./eventBase.ts";

/**
 * The refusal code for one hire blocker. One code per kind because each names a
 * different remedy — pick another engine, type a name, rename one of two — and
 * because the client already shows those three sentences for the same kinds in
 * squad setup, so the toast and the pre-submit notice cannot drift apart.
 */
const refusalForBlocker = (kind: FleetHireBlocker["kind"]): CommandRefusal => {
  switch (kind) {
    case "no-provider":
      return "fleet-role-has-no-provider";
    case "empty-name":
      return "fleet-role-needs-name";
    case "duplicate-name":
      return "fleet-roles-share-name";
  }
};

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
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `No fleet template at index ${command.templateIndex}.`,
          // Same reason-kind as an unknown id: the client asked for a template
          // this build does not ship, so the remedy is to update, not refresh.
          refusal: "unknown-fleet-template",
        });
      }

      const bossRoleId = command.bossRoleId ?? template.bossRoleId;

      if (!template.roleIds.includes(bossRoleId)) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Role '${bossRoleId}' is not part of template '${template.id}'.`,
          // The client named a boss role its own copy of the template has and
          // this build's copy does not, so the remedy is to update the app —
          // the same family as an unknown template, named for a role instead.
          refusal: "unknown-fleet-role",
        });
      }

      const plan = planFleetHire({
        template: { ...template, bossRoleId },
        providers: [],
        picks: command.picks,
        names: new Map((command.names ?? []).map((entry) => [entry.roleId, entry.name])),
      });

      const firstBlocker = plan.blockers[0];

      if (firstBlocker !== undefined) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `The hire is blocked: ${plan.blockers
            .map((blocker) => (blocker.kind === "duplicate-name" ? blocker.kind : blocker.roleId))
            .join(", ")}.`,
          // The client names its first blocker in the footer and lists the rest
          // behind it, so refusing with the first keeps the toast on the row the
          // user was already looking at. The detail above keeps the ids for a
          // client that does not know the code; the code is what a client that
          // does know it renders instead.
          refusal: refusalForBlocker(firstBlocker.kind),
        });
      }

      // A template only names roles in the catalogue, so this drops nothing;
      // it narrows the lookup so the avatar below is always a real role's.
      const membersWithRoles = plan.members.flatMap((member) => {
        const role = fleetRole(member.roleId);

        return role === undefined ? [] : [{ member, role }];
      });

      if (membersWithRoles.length !== plan.members.length) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Template '${template.id}' names a role that is not in the fleet catalogue.`,
          reason:
            "FLEET_TEMPLATES and the role catalogue are both static in the contracts package, and planFleetHire only emits the roles a template names, so the two can disagree only in a build where one shipped without the other — not from any client input.",
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
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Template '${template.id}' names no boss member.`,
          reason:
            "The boss member is chosen by the static template's bossRoleId, which was already checked against template.roleIds above, so a plan with no boss means a shipped template contradicts itself — a build-time bug, not a client input.",
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
