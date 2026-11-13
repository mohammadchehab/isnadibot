import {
  fleetTemplateRoles,
  type BotEngine,
  type BotSkill,
  type FleetHireBlocker,
  type FleetHireMember,
  type FleetHirePick,
  type FleetHirePlan,
  type FleetRole,
  type FleetTemplate,
  type ServerProvider,
} from "@isnadi/contracts";

import { seedSquadMember } from "./squadSeed.ts";

/**
 * What squad setup sends to the server to hire a fleet, and what the server
 * computes when it does. The plan is decided here, in one pure function, so the
 * preview a client shows and the hire the server performs cannot drift on what
 * a member starts with, and so the Create button knows what still blocks it
 * before it creates anything.
 */

/**
 * Names the user typed, by role, over the role's own name. The first member
 * keeps its role name when nothing was typed, so a hire without edits reads
 * like the card on screen 1.
 */
export type FleetHireNames = ReadonlyMap<string, string>;

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
