import {
  CommandId,
  FLEET_TEMPLATES,
  FleetRoleId,
  GROUP_HOP_BUDGET_DEFAULT,
  GroupHopBudget,
  fleetRole,
  type BotAvatar,
  type FleetHireBlocker,
  type FleetHireCommand,
  type FleetHireMember,
  type FleetTemplate,
  type FleetTemplateId,
  type FleetTemplateIndex,
  type GroupId,
  type ProviderInstanceId,
  type ProviderOptionSelection,
  type ServerProvider,
} from "@isnadi/contracts";
import {
  planFleetHire,
  reasoningOptions,
  seedSquadMember,
  type SquadSeedNotice,
} from "@isnadi/shared/fleet";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { dispatch } from "../operations/commands/dispatch.ts";
import { isRpcClientError } from "../rpc/client.ts";

/**
 * The squad screen's working copy of a hire. Everything on it is local: the
 * hire reaches the server as one `fleet.hire` command carrying the engines the
 * screen picked, and the server mints the ids, so nothing here survives the
 * screen except the squad it created.
 */

/** Why a member does not start on what its role asked for. Mostly the seed's word, plus the screen's own. */
export type HireMemberNotice = SquadSeedNotice | "model-unavailable";

/** One member as squad setup holds it: the plan's member plus what the row draws. */
export interface HireMember extends FleetHireMember {
  /** The role's own avatar, which the contract member no longer carries. */
  readonly avatar: BotAvatar;
  readonly notice: HireMemberNotice | null;
}

/**
 * Where the draft's one command stands.
 *
 * `draft` has never gone out. `failed` means the server answered a failure: a
 * retry may resend the same command id, and a draft edited since needs a fresh
 * one, since the same id would answer for content the user changed. `unknown`
 * means the send may or may not have landed: the id is kept and the draft turns
 * read-only until a resend of that id answers what happened.
 */
export type HireSendState =
  | { readonly status: "draft" }
  | { readonly status: "failed"; readonly edited: boolean }
  | { readonly status: "unknown" };

/** Whether a failed send is one we can account for, which decides what a retry may do. */
export type HireSendOutcome = "failed" | "unknown";

export interface HireDraft {
  readonly templateId: FleetTemplateId;
  readonly templateIndex: FleetTemplateIndex;
  /** The group's name, which the template names. */
  readonly name: string;
  readonly bossRoleId: FleetRoleId;
  readonly hopBudget: GroupHopBudget;
  readonly members: ReadonlyArray<HireMember>;
  /** The one command this draft sends. Minted once, so pressing Create twice finishes the same squad. */
  readonly commandId: CommandId;
  readonly createdAt: string;
  readonly send: HireSendState;
}

/** Mints the id a retry needs after a failed send on an edited draft. The web passes `crypto.randomUUID`. */
export type MakeId = () => string;

/** The level the member currently saves, for the re-check a model change needs. */
const REASONING_OPTION_IDS = new Set(["reasoningEffort", "effort"]);

function reasoningLevelOf(member: HireMember, roleId: FleetRoleId): string {
  const saved = member.engine?.options?.find((candidate) =>
    REASONING_OPTION_IDS.has(candidate.id),
  )?.value;

  return Predicate.isString(saved) ? saved : (fleetRole(roleId)?.reasoning ?? "medium");
}

/**
 * The template's index, the only way a client names a template to the server.
 * A template outside `FLEET_TEMPLATES` cannot be hired, so this is a caller bug.
 */
function templateIndexOf(templateId: FleetTemplateId): FleetTemplateIndex {
  const index = FLEET_TEMPLATES.findIndex((candidate) => candidate.id === templateId);

  if (index < 0) {
    throw new Error(`No fleet template '${templateId}' to hire.`);
  }

  return index;
}

/** A plan member with the role's avatar and the seed's notice, which the contract member does not carry. */
function withRole(member: FleetHireMember, providers: ReadonlyArray<ServerProvider>): HireMember {
  const role = fleetRole(member.roleId);

  if (role === undefined) {
    throw new Error(`Role '${member.roleId}' is not in the fleet catalogue.`);
  }

  return { ...member, avatar: role.avatar, notice: seedSquadMember(role, providers).notice };
}

/**
 * The draft squad setup opens with: the plan's members, each seeded to the
 * engine the role asks for and already carrying the one command id a hire or a
 * retry sends.
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
  const plan = planFleetHire({ template, providers });

  return {
    templateId: template.id,
    templateIndex: templateIndexOf(template.id),
    name: template.name,
    bossRoleId: template.bossRoleId,
    hopBudget: GroupHopBudget.make(GROUP_HOP_BUDGET_DEFAULT),
    members: plan.members.map((member) => withRole(member, providers)),
    commandId: CommandId.make(makeId()),
    createdAt,
    send: { status: "draft" },
  };
}

/** Whether a send whose outcome is unknown still owns the draft, so nothing may edit it. */
export function draftLocked(draft: HireDraft): boolean {
  return draft.send.status === "unknown";
}

/**
 * The draft after an edit. A draft whose send outcome is unknown is read-only
 * until that outcome is known, and a draft whose send failed remembers that it
 * changed, so the next send mints the fresh command id it needs.
 */
function afterEdit(draft: HireDraft): HireDraft {
  switch (draft.send.status) {
    case "draft":
      return draft;
    case "failed":
      return { ...draft, send: { status: "failed", edited: true } };
    case "unknown":
      return draft;
  }
}

/** The draft with one member replaced, keeping everything else as it was. */
function replaceMember(
  draft: HireDraft,
  roleId: FleetRoleId,
  change: (member: HireMember) => HireMember,
): HireDraft {
  if (draftLocked(draft)) return draft;

  const members = draft.members.map((member) =>
    member.roleId === roleId ? change(member) : member,
  );

  return afterEdit({ ...draft, members });
}

/**
 * Applies a model pick to a member. The reasoning level it saved is re-checked
 * against the new model: when the model has no such level, the model's own
 * default stands and the member carries the "reasoning-adjusted" notice, so the
 * screen says so before Create rather than after the bot exists.
 *
 * A pick whose provider or model is no longer on the server keeps the member's
 * choice on screen and marks it "model-unavailable": the picker stays usable, so
 * the user can pick again, and `draftBlockers` stops Create from making a bot
 * that has nowhere to run.
 */
export function setMemberModel(
  draft: HireDraft,
  roleId: FleetRoleId,
  pick: { readonly instanceId: ProviderInstanceId; readonly model: string },
  providers: ReadonlyArray<ServerProvider>,
): HireDraft {
  return replaceMember(draft, roleId, (member) => {
    const provider = providers.find((candidate) => candidate.instanceId === pick.instanceId);

    const model = provider?.models.find((candidate) => candidate.slug === pick.model);

    if (model === undefined) {
      return {
        ...member,
        engine: {
          provider: pick.instanceId,
          model: pick.model,
          fallbacks: [],
        },
        notice: "model-unavailable",
      };
    }

    const { options, adjusted } = reasoningOptions(model, reasoningLevelOf(member, roleId));

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

/**
 * Makes `roleId` the boss. The template's boss is the default; the frames allow
 * another. The plan's order is boss first, so the members are re-sorted here:
 * a boss picked on screen 2b heads the squad the hire creates, the same order
 * screen 2 shows.
 */
export function setBoss(draft: HireDraft, roleId: FleetRoleId): HireDraft {
  if (draftLocked(draft)) return draft;

  const members = draft.members.map((member) => ({
    ...member,
    isBoss: member.roleId === roleId,
  }));

  const boss = members.find((member) => member.isBoss);

  if (boss === undefined) return draft;

  return afterEdit({
    ...draft,
    bossRoleId: roleId,
    members: [boss, ...members.filter((member) => member !== boss)],
  });
}

/** The reply budget every new chat in this space starts with. */
export function setHopBudget(draft: HireDraft, hopBudget: GroupHopBudget): HireDraft {
  return draftLocked(draft) ? draft : afterEdit({ ...draft, hopBudget });
}

/**
 * What still stops Create, asked of the members as they stand on screen. The
 * rules are the plan's, which the server runs again on the hire, plus the one
 * only the screen knows: a member pinned to a model the server no longer offers
 * has an engine it cannot run on.
 */
export function draftBlockers(draft: HireDraft): ReadonlyArray<FleetHireBlocker> {
  const template = FLEET_TEMPLATES.find((candidate) => candidate.id === draft.templateId);

  if (template === undefined) return [];

  const plan = planFleetHire({
    template: { ...template, bossRoleId: draft.bossRoleId },
    // The members already carry their engines, so the plan seeds nothing here;
    // a member without one is exactly the `no-provider` blocker.
    providers: [],
    picks: draft.members.flatMap((member) =>
      member.engine === null ? [] : [{ roleId: member.roleId, engine: member.engine }],
    ),
    names: new Map(draft.members.map((member) => [member.roleId, member.name])),
  });

  const stale: ReadonlyArray<FleetHireBlocker> = draft.members.flatMap((member) =>
    member.notice === "model-unavailable"
      ? [{ kind: "no-provider" as const, roleId: member.roleId }]
      : [],
  );

  return [...plan.blockers, ...stale];
}

/**
 * Whether a failed send may still have landed. A dropped socket or an
 * interruption can lose the answer after the server applied the command; a
 * refused command or an environment that was never connected cannot.
 */
function isSocketLoss(cause: unknown): boolean {
  if (!isRpcClientError(cause)) return false;

  return Match.value(cause.reason).pipe(
    Match.tags({
      SocketReadError: () => true,
      SocketWriteError: () => true,
      SocketCloseError: () => true,
    }),
    Match.orElse(() => false),
  );
}

function sendOutcome(cause: Cause.Cause<unknown>): HireSendOutcome {
  if (Cause.hasInterruptsOnly(cause)) return "unknown";

  const failure = Cause.findErrorOption(cause);

  return Option.isSome(failure) && isSocketLoss(failure.value) ? "unknown" : "failed";
}

/**
 * What one Create did. A blocked draft sent nothing; a failed send hands back
 * the draft to keep, already marked with how it failed.
 */
export type HireFleetResult =
  | {
      readonly status: "sent";
      readonly sequence: number;
      /**
       * The squad the hire created. The server mints it, so this is the only
       * way the screen learns which group to land on. Absent only when the
       * answering environment predates the id in the answer.
       */
      readonly groupId?: GroupId;
    }
  | { readonly status: "blocked"; readonly blockers: ReadonlyArray<FleetHireBlocker> }
  | { readonly status: "failed"; readonly outcome: HireSendOutcome; readonly draft: HireDraft };

/** How the hire reaches the server as a command: the draft the screen finished. */
export interface HireFleetInput {
  readonly draft: HireDraft;
  readonly makeId: MakeId;
}

/**
 * The draft to send. Its command id stands for what it sends, so only a draft
 * whose send failed and was edited since needs a fresh one: resending the old
 * id would replay a receipt for the engines the user has already changed.
 */
function prepareSend(draft: HireDraft, makeId: MakeId): HireDraft {
  if (draft.send.status !== "failed" || !draft.send.edited) return draft;

  return { ...draft, commandId: CommandId.make(makeId()), send: { status: "draft" } };
}

/** The command one hire sends: the template by index, the engines picked for its roles. */
function hireCommand(draft: HireDraft): FleetHireCommand {
  const picks = draft.members.flatMap((member) =>
    member.engine === null ? [] : [{ roleId: member.roleId, engine: member.engine }],
  );

  const [firstPick, ...otherPicks] = picks;

  if (firstPick === undefined) {
    throw new Error("A hire needs at least one member.");
  }

  const overridesTemplateBoss =
    draft.bossRoleId !== FLEET_TEMPLATES[draft.templateIndex]?.bossRoleId;

  return {
    type: "fleet.hire",
    commandId: draft.commandId,
    templateIndex: draft.templateIndex,
    picks: [firstPick, ...otherPicks],
    ...(overridesTemplateBoss ? { bossRoleId: draft.bossRoleId } : {}),
    hopBudget: draft.hopBudget,
    createdAt: draft.createdAt,
  };
}

/**
 * Hires the squad: one `fleet.hire` command that the server decides into every
 * bot and the group, under the draft's own command id. A retry after a failure
 * resends that id, so the server replays the hire it already stored instead of
 * making a second squad, and the draft only mints a new id when a failed send
 * was followed by an edit the stored hire does not describe.
 */
export const hireFleet = Effect.fn("Fleet.hireFleet")(function* (input: HireFleetInput) {
  // A locked draft is unedited, so `prepareSend` hands it back with its id
  // intact: the resend answers what the first attempt did. It cannot have
  // gained a blocker either, since every mutator refuses while locked.
  const draft = prepareSend(input.draft, input.makeId);
  const blockers = draftBlockers(draft);

  if (blockers.length > 0) return { status: "blocked", blockers } satisfies HireFleetResult;

  return replayResult(draft, yield* dispatch(hireCommand(draft)).pipe(Effect.exit));
});

/** What a finished send did, with the draft a failure hands back to the screen. */
function replayResult(
  draft: HireDraft,
  exit: Exit.Exit<{ readonly sequence: number; readonly createdGroupId?: GroupId }, unknown>,
): HireFleetResult {
  if (Exit.isSuccess(exit)) {
    const { sequence, createdGroupId } = exit.value;

    return {
      status: "sent",
      sequence,
      ...(createdGroupId === undefined ? {} : { groupId: createdGroupId }),
    };
  }

  const outcome = sendOutcome(exit.cause);

  return {
    status: "failed",
    outcome,
    draft: {
      ...draft,
      send: outcome === "unknown" ? { status: "unknown" } : { status: "failed", edited: false },
    },
  };
}
