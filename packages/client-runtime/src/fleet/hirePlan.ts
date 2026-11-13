import {
  fleetTemplateRoles,
  type BotEngine,
  type BotSkill,
  type FleetRole,
  type FleetRoleId,
  type FleetTemplate,
  type FleetTemplateId,
  type ServerProvider,
} from "@isnadi/contracts";

import { seedSquadMember } from "./squadSeed.ts";

/**
 * What squad setup sends to the server to hire a fleet: one `bot.create` per
 * role and one `group.create` carrying the template. The plan is decided here,
 * in one pure function, so the web and mobile hire flows cannot drift on what a
 * member starts with, and so the Create button knows what still blocks it
 * before it creates anything.
 */

/** The engine squad setup picked for a role, instead of what the role asks for. */
export interface FleetHirePick {
  readonly roleId: FleetRoleId;
  readonly engine: BotEngine;
}

/** A member as the hire creates it, before the caller gives it an id. */
export interface FleetHireMember {
  readonly roleId: FleetRoleId;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly isBoss: boolean;
  readonly skills: ReadonlyArray<BotSkill>;
  /** Null when no provider can run this role, which blocks the hire. */
  readonly engine: BotEngine | null;
}

/**
 * Why Create cannot go yet. A blocker is about the hire as a whole: the roles
 * are the user's to fix on screen 2b, not to discover after the fact.
 */
export type FleetHireBlocker =
  | { readonly kind: "no-provider"; readonly roleId: FleetRoleId }
  | { readonly kind: "empty-name"; readonly roleId: FleetRoleId }
  | { readonly kind: "duplicate-name"; readonly names: ReadonlyArray<string> };

export interface FleetHirePlan {
  readonly templateId: FleetTemplateId;
  readonly bossRoleId: FleetRoleId;
  /** Boss first, then the template's card order. */
  readonly members: ReadonlyArray<FleetHireMember>;
  readonly blockers: ReadonlyArray<FleetHireBlocker>;
}

/** A role's skills start on; squad setup can turn them off per member later. */
function skillsFor(role: FleetRole): ReadonlyArray<BotSkill> {
  return role.skills.map((skillId) => ({ skillId, enabled: true }));
}

function memberFor(
  role: FleetRole,
  isBoss: boolean,
  picks: ReadonlyMap<string, BotEngine>,
  providers: ReadonlyArray<ServerProvider>,
  name: string,
): FleetHireMember {
  return {
    roleId: role.id,
    name,
    title: role.name,
    description: role.description,
    isBoss,
    skills: skillsFor(role),
    engine: picks.get(role.id) ?? seedSquadMember(role, providers).engine,
  };
}

/**
 * Names the user typed, by role, over the role's own name. The first member
 * keeps its role name when nothing was typed, so a hire without edits reads
 * like the card on screen 1.
 */
export type FleetHireNames = ReadonlyMap<string, string>;

/**
 * The members and the blockers for hiring `template` with `picks` and `names`.
 * A pick wins over the role's asked-for engine, so squad setup's model sheet is
 * the last word; without one the seeded engine stands. Two members cannot share
 * a name, because the group chat addresses bots by name.
 */
export function planFleetHire({
  template,
  providers,
  picks = [],
  names = new Map(),
}: {
  readonly template: FleetTemplate;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly picks?: ReadonlyArray<FleetHirePick>;
  readonly names?: FleetHireNames;
}): FleetHirePlan {
  const pickByRole = new Map(picks.map((pick) => [pick.roleId, pick.engine]));

  const members = fleetTemplateRoles(template).map((role) =>
    memberFor(
      role,
      role.id === template.bossRoleId,
      pickByRole,
      providers,
      names.get(role.id) ?? role.name,
    ),
  );

  const blockers: Array<FleetHireBlocker> = [];

  for (const member of members) {
    if (member.name.trim().length === 0) {
      blockers.push({ kind: "empty-name", roleId: member.roleId });
    }

    if (member.engine === null) blockers.push({ kind: "no-provider", roleId: member.roleId });
  }

  const seen = new Map<string, Array<string>>();

  for (const member of members) {
    const key = member.name.trim().toLowerCase();

    if (key.length === 0) continue;

    seen.set(key, [...(seen.get(key) ?? []), member.roleId]);
  }

  for (const [name, roleIds] of seen) {
    if (roleIds.length > 1) blockers.push({ kind: "duplicate-name", names: [name] });
  }

  return {
    templateId: template.id,
    bossRoleId: template.bossRoleId,
    members,
    blockers,
  };
}
