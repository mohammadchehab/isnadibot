import * as Schema from "effect/Schema";

import { BotSkill } from "../botSkills.ts";
import {
  CommandId,
  FleetRoleId,
  FleetTemplateId,
  IsoDateTime,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { BotEngine, GroupHopBudget } from "../orchestration/roster.ts";

/**
 * Hiring a fleet is one server command, not six client writes. The client asks
 * for a template by its index in `FLEET_TEMPLATES`, so the template itself, its
 * roles and its `fleetTemplateId` never cross the wire as trusted input, and
 * every member plus the group is created in one decide call against one
 * receipt: a dropped socket cannot leave a half-built squad behind.
 */

/** A template index, the only way a client names a template. Out-of-range is refused, never defaulted. */
export const FleetTemplateIndex = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export type FleetTemplateIndex = typeof FleetTemplateIndex.Type;

/** One member as the server would create it. `engine` is null when no provider can run the role. */
export const FleetHireMember = Schema.Struct({
  roleId: FleetRoleId,
  name: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  isBoss: Schema.Boolean,
  skills: Schema.Array(BotSkill),
  engine: Schema.NullOr(BotEngine),
});

export type FleetHireMember = typeof FleetHireMember.Type;

/** Why the hire cannot go yet. A blocker is about the hire as a whole. */
export const FleetHireBlocker = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("no-provider"), roleId: FleetRoleId }),
  Schema.Struct({ kind: Schema.Literal("empty-name"), roleId: FleetRoleId }),
  Schema.Struct({
    kind: Schema.Literal("duplicate-name"),
    names: Schema.Array(TrimmedNonEmptyString),
  }),
]);

export type FleetHireBlocker = typeof FleetHireBlocker.Type;

/** A template's members and what still blocks them. Boss first, then the template's card order. */
export const FleetHirePlan = Schema.Struct({
  templateId: FleetTemplateId,
  bossRoleId: FleetRoleId,
  members: Schema.Array(FleetHireMember),
  blockers: Schema.Array(FleetHireBlocker),
});

export type FleetHirePlan = typeof FleetHirePlan.Type;

/** The engine squad setup picked for a role, instead of what the role asks for. */
export const FleetHirePick = Schema.Struct({
  roleId: FleetRoleId,
  engine: BotEngine,
});

export type FleetHirePick = typeof FleetHirePick.Type;

/** A name the user typed for a role, instead of the role's own name. */
export const FleetHireName = Schema.Struct({
  roleId: FleetRoleId,
  name: TrimmedNonEmptyString,
});

export type FleetHireName = typeof FleetHireName.Type;

/**
 * One hire. The server mints the group and bot ids and derives the
 * `fleetTemplateId`, so nothing a client sends can name an id that persists.
 *
 * `picks` is required and must name one engine per template role. The decider
 * stays pure on replay, so it cannot see which providers the environment has:
 * the client asks `fleet.plan` (an RPC handler, which can) and sends the
 * engines back. A client-chosen engine is not a new trust boundary —
 * `bot.create` already takes one.
 */
export const FleetHireCommand = Schema.Struct({
  type: Schema.Literal("fleet.hire"),
  commandId: CommandId,
  templateIndex: FleetTemplateIndex,
  /** The engine squad setup picked for each role; a role with no pick is refused. */
  picks: Schema.NonEmptyArray(FleetHirePick),
  /** Names the user typed, by role; a role absent here keeps its role's name. */
  names: Schema.optional(Schema.Array(FleetHireName)),
  /** Overrides the template's boss role. Refused unless the role is in the template. */
  bossRoleId: Schema.optional(FleetRoleId),
  /** Overrides the template's name for the created group. */
  groupName: Schema.optional(TrimmedNonEmptyString),
  hopBudget: Schema.optional(GroupHopBudget),
  createdAt: IsoDateTime,
});

export type FleetHireCommand = typeof FleetHireCommand.Type;
