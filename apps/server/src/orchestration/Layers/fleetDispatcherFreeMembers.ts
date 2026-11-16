import {
  isGroupBotMember,
  type BotId,
  type FleetRoleId,
  type IsoDateTime,
  type OrchestrationBot,
  type OrchestrationGroup,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import {
  deriveBotStatus,
  idleSince,
  type BotStatus,
  type BotStatusInput,
} from "@isnadi/shared/botStatus";

/*
 * Who is free, and which free member takes the next item.
 *
 * The dispatcher's decision is plain code over one read model: no model call ever routes work.
 * These reads were part of `FleetDispatcherReactor.ts`, which keeps only the wiring — the events it
 * listens to, the claims it spends, and the receipts it publishes.
 */

/**
 * One bot's reading of the shared status rule: the status the dispatcher decides from, and the
 * idle time it ranks free members by. Both come from the same input, so both are read together.
 */
export interface MemberReading {
  readonly status: BotStatus;
  readonly idleSince: IsoDateTime | null;
}

export type StatusLookup = (botId: BotId) => MemberReading;

/**
 * Derives each bot's reading at most once for one read model. A pass decides from a single
 * snapshot, so no bot's status can move while it runs: asking again for the next queued item only
 * re-filters every live chat in the environment for an answer that has not changed (TASK-242). The
 * lookup is made for one snapshot and discarded with it, so there is no cache to go stale against
 * the event-sourced model.
 */
export function statusLookup(readModel: OrchestrationReadModel): StatusLookup {
  const chats = readModel.threads.filter((thread) => thread.deletedAt === null);
  const workItems = readModel.workItems ?? [];
  const delegations = readModel.delegations ?? [];
  const readings = new Map<BotId, MemberReading>();

  return (botId) => {
    const known = readings.get(botId);

    if (known !== undefined) return known;

    const input: BotStatusInput = { botId, chats, workItems, delegations };

    const reading: MemberReading = {
      status: deriveBotStatus(input),
      idleSince: idleSince(input),
    };

    readings.set(botId, reading);

    return reading;
  };
}

/**
 * Whether the dispatcher may hand this bot the next queued item: it exists, it is not archived, and
 * the shared status rule (`@isnadi/shared/botStatus`) reads it as idle. Asking, held and busy all
 * mean the bot is not free, so only `idle` is dispatchable.
 */
export function isBotIdle(readModel: OrchestrationReadModel, botId: BotId): boolean {
  const bot = readModel.bots.find((candidate) => candidate.id === botId);

  if (bot === undefined || bot.archivedAt !== null) return false;

  return statusLookup(readModel)(botId).status === "idle";
}

/**
 * A free member ranked by who has been free longest. A bot with no turn at all has no idle time,
 * which ranks it above every bot with one; the total order means the same read model always picks
 * the same bot. Nothing here calls a model: the pick is the receipt's `botId`.
 */
interface IdleRank {
  readonly idleSince: IsoDateTime | null;
  readonly botId: BotId;
}

function compareIdleRank(left: IdleRank, right: IdleRank): number {
  if (left.idleSince !== right.idleSince) {
    if (left.idleSince === null) return -1;

    if (right.idleSince === null) return 1;

    return left.idleSince.localeCompare(right.idleSince);
  }

  return left.botId.localeCompare(right.botId);
}

/**
 * The member that takes the next item: the idle specialist who has been free longest, or the boss
 * when it is the only bot in the group. Two idle members are never both woken for one item, and no
 * model is asked to choose between them.
 *
 * Being idle is the whole test. Whether the member already has a chat is the caller's problem: a
 * hired member starts without one and is given the chat it would have opened for itself, so
 * leaving it out here would leave a fresh team unable to work at all.
 *
 * An item that names a role narrows the pick to the members hired as that role, and says so
 * separately when the group holds nobody with it. The two "nobody" answers are not the same news:
 * no holder means the item cannot move until someone is hired, while every holder being busy means
 * the item moves as soon as one is free. The caller answers them differently.
 */
export type PickResult =
  | { readonly kind: "member"; readonly bot: OrchestrationBot }
  | { readonly kind: "none"; readonly reason: "no-idle-member" | "no-role-holder" };

export function pickIdleMember(
  readModel: OrchestrationReadModel,
  group: OrchestrationGroup,
  busy: ReadonlySet<BotId> = new Set(),
  reading: StatusLookup = statusLookup(readModel),
  role?: FleetRoleId,
): PickResult {
  const members = group.members.filter(isGroupBotMember).map((member) => member.botId);

  // The role is fixed when a bot is created, so a member can only gain one by being hired or
  // assigned with it — both of which wake the group, which is what lets a waiting item move
  // without a restart. A fired member does not count: it is not there to take the work.
  const holdsRole = (botId: BotId): boolean => {
    const bot = readModel.bots.find((candidate) => candidate.id === botId);

    return bot !== undefined && bot.archivedAt === null && bot.roleId === role;
  };

  const qualified = role === undefined ? members : members.filter(holdsRole);

  // Nobody in the group was hired as this role, so no amount of idleness would ever hand the item
  // out.
  if (role !== undefined && qualified.length === 0) {
    return { kind: "none", reason: "no-role-holder" };
  }

  const specialists = qualified.filter((botId) => botId !== group.bossBotId);
  const candidates = specialists.length > 0 ? specialists : qualified;

  const free = candidates
    .filter((candidate) => !busy.has(candidate) && reading(candidate).status === "idle")
    .flatMap((candidate) => {
      const bot = readModel.bots.find((candidateBot) => candidateBot.id === candidate);

      // `deriveBotStatus` knows nothing about hiring, so a fired bot still reads as idle.
      if (bot === undefined || bot.archivedAt !== null) return [];

      return [{ bot, rank: { botId: candidate, idleSince: reading(candidate).idleSince } }];
    })
    .toSorted((left, right) => compareIdleRank(left.rank, right.rank));

  const picked = free[0];

  return picked === undefined
    ? { kind: "none", reason: "no-idle-member" }
    : { kind: "member", bot: picked.bot };
}
