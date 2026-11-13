import {
  BotId,
  CommandId,
  FleetRoleId,
  GROUP_HOP_BUDGET_DEFAULT,
  GroupHopBudget,
  GroupId,
  fleetRole,
  type FleetTemplate,
  type FleetTemplateId,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { createBot, createGroup } from "../operations/commands.ts";
import { planBlockers, planFleetHire, type FleetHireMember } from "./hirePlan.ts";
import { reasoningOptionsFor } from "./squadSeed.ts";

/**
 * The squad screen's working copy of a hire: every id and command id minted
 * once, so pressing Create twice finishes the same squad instead of starting a
 * second one, and so a failed hire can be retried where it stopped.
 */

/** One member as squad setup holds it, before anything exists on the server. */
export interface HireMember extends FleetHireMember {
  readonly botId: BotId;
  readonly createCommandId: CommandId;
}

export interface HireDraft {
  readonly templateId: FleetTemplateId;
  /** The group's name, which the template names. */
  readonly name: string;
  readonly bossRoleId: FleetRoleId;
  readonly hopBudget: GroupHopBudget;
  readonly members: ReadonlyArray<HireMember>;
  readonly groupId: GroupId;
  readonly groupCommandId: CommandId;
  /** Fixed for the draft's life, so a retry sends the same command it sent before. */
  readonly createdAt: string;
}

/** Mints the ids a draft needs. The web passes `crypto.randomUUID`. */
export type MakeId = () => string;

const REASONING_OPTION_IDS = new Set(["reasoningEffort", "effort"]);

/** The level the member currently saves, for the re-check a model change needs. */
function reasoningLevelOf(member: HireMember, roleId: FleetRoleId): string {
  const saved = member.engine?.options?.find((candidate) =>
    REASONING_OPTION_IDS.has(candidate.id),
  )?.value;

  return Predicate.isString(saved) ? saved : (fleetRole(roleId)?.reasoning ?? "medium");
}

/**
 * The draft squad setup opens with: the plan's members, each seeded to the
 * engine the role asks for, with ids already minted so the screen only has to
 * hand back the draft it edited.
 */
export function createHireDraft({
  template,
  providers,
  makeId,
  createdAt,
}: {
  readonly template: FleetTemplate;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly makeId: MakeId;
  readonly createdAt: string;
}): HireDraft {
  const members = planFleetHire({ template, providers }).members.map(
    (member): HireMember => ({
      ...member,
      botId: BotId.make(`bot-${makeId()}`),
      createCommandId: CommandId.make(makeId()),
    }),
  );

  return {
    templateId: template.id,
    name: template.name,
    bossRoleId: template.bossRoleId,
    hopBudget: GroupHopBudget.make(GROUP_HOP_BUDGET_DEFAULT),
    members,
    groupId: GroupId.make(`group-${makeId()}`),
    groupCommandId: CommandId.make(makeId()),
    createdAt,
  };
}

/** The draft with one member replaced, keeping everything else as it was. */
function replaceMember(
  draft: HireDraft,
  roleId: FleetRoleId,
  change: (member: HireMember) => HireMember,
): HireDraft {
  return {
    ...draft,
    members: draft.members.map((member) => (member.roleId === roleId ? change(member) : member)),
  };
}

/**
 * Applies a model pick to a member. The reasoning level it saved is re-checked
 * against the new model: when the model has no such level, the model's own
 * default stands and the member carries the "reasoning-adjusted" notice, so the
 * screen says so before Create rather than after the bot exists.
 */
export function setMemberModel(
  draft: HireDraft,
  roleId: FleetRoleId,
  pick: { readonly instanceId: ProviderInstanceId; readonly model: string },
  providers: ReadonlyArray<ServerProvider>,
): HireDraft {
  return replaceMember(draft, roleId, (member) => {
    const provider = providers.find((candidate) => candidate.instanceId === pick.instanceId);

    const { options, adjusted } = reasoningOptionsFor(
      provider?.models.find((candidate) => candidate.slug === pick.model),
      reasoningLevelOf(member, roleId),
    );

    return {
      ...member,
      engine: {
        provider: pick.instanceId,
        model: pick.model,
        ...(options.length > 0 ? { options } : {}),
        fallbacks: [],
      },
      notice: adjusted ? "reasoning-adjusted" : null,
    };
  });
}

/** Applies the reasoning options the member's tier picker produced. */
export function setMemberReasoning(
  draft: HireDraft,
  roleId: FleetRoleId,
  options: ReadonlyArray<ProviderOptionSelection>,
): HireDraft {
  return replaceMember(draft, roleId, (member) => {
    if (member.engine === null) return member;

    const { provider, model, fallbacks } = member.engine;

    return {
      ...member,
      engine: { provider, model, ...(options.length > 0 ? { options } : {}), fallbacks },
      notice: null,
    };
  });
}

/** Makes `roleId` the boss. The template's boss is the default; the frames allow another. */
export function setBoss(draft: HireDraft, roleId: FleetRoleId): HireDraft {
  return {
    ...draft,
    bossRoleId: roleId,
    members: draft.members.map((member) => ({ ...member, isBoss: member.roleId === roleId })),
  };
}

/** The reply budget every new chat in this space starts with. */
export function setHopBudget(draft: HireDraft, hopBudget: GroupHopBudget): HireDraft {
  return { ...draft, hopBudget };
}

/** What still stops Create, asked of the members as they stand on screen. */
export function draftBlockers(draft: HireDraft) {
  return planBlockers(draft.members);
}

/**
 * Why a hire stopped. `step` says how far it got: nothing sent ("blocked"), a
 * member's `bot.create`, or the `group.create` that closes the hire. The draft
 * keeps its command ids, so handing the same draft back finishes the squad.
 */
export class HireFleetError extends Schema.TaggedErrorClass<HireFleetError>()("HireFleetError", {
  step: Schema.Literals(["blocked", "member", "group"]),
  /** The member the step belongs to; absent when a duplicate name blocks the hire. */
  roleId: Schema.optional(FleetRoleId),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.step === "blocked"
      ? `The hire is blocked${this.roleId === undefined ? "" : ` at ${this.roleId}`}.`
      : `The hire failed at the ${this.step} step${this.roleId === undefined ? "" : ` for ${this.roleId}`}.`;
  }
}

export interface HireFleetResult {
  readonly groupId: GroupId;
  readonly botIds: ReadonlyArray<BotId>;
}

/** How the hire reaches the server as a command: the draft the screen finished. */
export interface HireFleetInput {
  readonly draft: HireDraft;
}

/**
 * Creates the squad: one bot per member in screen order, then the group that
 * holds them under the template. Every command carries the draft's own command
 * id, so a retry after a failure replays what already landed instead of
 * creating a second bot, and a blocked draft never creates a partial squad.
 */
export const hireFleet = Effect.fn("Fleet.hireFleet")(function* (draft: HireDraft) {
  const blocked = draftBlockers(draft)[0];

  if (blocked !== undefined) {
    return yield* new HireFleetError({
      step: "blocked",
      ...(blocked.kind === "duplicate-name" ? {} : { roleId: blocked.roleId }),
    });
  }

  for (const member of draft.members) {
    yield* createBot({
      commandId: member.createCommandId,
      botId: member.botId,
      name: member.name,
      title: member.title,
      description: member.description,
      avatar: member.avatar,
      engine: member.engine,
      skills: member.skills,
      skillRegistryAccess: false,
      sandbox: null,
      groupId: null,
      createdAt: draft.createdAt,
    }).pipe(
      Effect.mapError(
        (cause) => new HireFleetError({ step: "member", roleId: member.roleId, cause }),
      ),
    );
  }

  yield* createGroup({
    commandId: draft.groupCommandId,
    groupId: draft.groupId,
    name: draft.name,
    bossBotId: draft.members.find((member) => member.roleId === draft.bossRoleId)?.botId,
    specialistBotIds: draft.members
      .filter((member) => member.roleId !== draft.bossRoleId)
      .map((member) => member.botId),
    hopBudget: draft.hopBudget,
    fleetTemplateId: draft.templateId,
    createdAt: draft.createdAt,
  }).pipe(Effect.mapError((cause) => new HireFleetError({ step: "group", cause })));

  return {
    groupId: draft.groupId,
    botIds: draft.members.map((member) => member.botId),
  } satisfies HireFleetResult;
});
