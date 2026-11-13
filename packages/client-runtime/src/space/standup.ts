import type { WorkItemSummary } from "@isnadi/contracts";
import type { BotStatusChat, BotStatusDelegation } from "@isnadi/shared/botStatus";

import { buildCapacity, type Capacity, type CapacityBot } from "../fleet/capacity.ts";
import { spaceMembers, type SpaceGroup } from "./overview.ts";

/**
 * The space's standup: what every bot is on right now, the cards waiting in the
 * queue, and the blocked ones with who has to move first. It is derived from the
 * shell snapshot and stream alone, so a client on another machine reads the same
 * report as the one hosting the environment.
 */

/** The work-item fields a standup line reads. */
export type StandupWorkItem = Pick<
  WorkItemSummary,
  "id" | "groupId" | "title" | "state" | "ownerBotId" | "createdAt" | "blockedOn"
>;

/** A chat as the shell stream carries it: the status fields plus the group it answers for. */
export type StandupChat = BotStatusChat & {
  readonly groupId?: string | null | undefined;
};

/** How many queued cards the block lists before it stops and counts the rest. */
export const STANDUP_QUEUE_LIMIT = 5;

/** A card in the queue and whose it is. */
export interface StandupQueueItem {
  readonly id: string;
  readonly title: string;
  /** Null while nobody owns the card yet. */
  readonly ownerName: string | null;
}

/** Who has to move before a blocked card can go on. */
export type StandupBlockerOwner =
  | { readonly kind: "user" }
  | { readonly kind: "bot"; readonly name: string | null }
  | { readonly kind: "unstated" };

/** A blocked card and its blocker. */
export interface StandupBlocker {
  readonly id: string;
  readonly title: string;
  readonly owner: StandupBlockerOwner;
  /** The reason the card gives, which is what a person reads first. */
  readonly note: string | null;
}

export interface StandupReport {
  /** One row per bot, boss first, with what each is doing and how many are in each state. */
  readonly capacity: Capacity;
  /** The cards next up, oldest first, cut at {@link STANDUP_QUEUE_LIMIT}. */
  readonly queue: ReadonlyArray<StandupQueueItem>;
  /** How many cards are queued in all, which is what the list is a window onto. */
  readonly queueTotal: number;
  /** Blocked cards, oldest first, each with who has to move first. */
  readonly blocked: ReadonlyArray<StandupBlocker>;
  /** True when every bot is idle and nothing waits in the queue. */
  readonly isQuiet: boolean;
}

export interface SpaceStandupInput {
  readonly group: SpaceGroup;
  /** The environment's bots; a bot outside the group is left out. */
  readonly bots: ReadonlyArray<CapacityBot>;
  /** The environment's chats; a chat outside the group is left out. */
  readonly chats: ReadonlyArray<StandupChat>;
  /** The environment's work items; an item outside the group is left out. */
  readonly workItems: ReadonlyArray<StandupWorkItem>;
  readonly delegations: ReadonlyArray<BotStatusDelegation>;
}

/** The queue is what the board shows in its first column: not taken yet, or taken but not begun. */
const QUEUE_STATES: ReadonlySet<string> = new Set(["queued", "assigned"]);

/** Oldest first, then by id so two cards saved in the same instant keep a stable order. */
const oldestFirst = (left: StandupWorkItem, right: StandupWorkItem) =>
  left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);

function blockerOwner(
  item: StandupWorkItem,
  names: ReadonlyMap<string, string>,
): StandupBlockerOwner {
  const blockedOn = item.blockedOn;

  if (blockedOn === undefined) return { kind: "unstated" };

  if (blockedOn.by === "user") return { kind: "user" };

  const name = blockedOn.botId === undefined ? null : (names.get(blockedOn.botId) ?? null);

  return { kind: "bot", name };
}

/**
 * The space's standup, read from the snapshot. The caller passes the whole
 * environment; the scoping to one group happens here, the same way the space's
 * activity list scopes: the group's own chats and cards, plus those of a bot
 * that is a member of it.
 *
 * Capacity comes from `buildCapacity`, so a bot reads the same here as it does in
 * the group's capacity rows: asking, held, busy, idle, in that precedence.
 */
export function spaceStandup(input: SpaceStandupInput): StandupReport {
  const members = spaceMembers(input.group);

  const chats = input.chats.filter(
    (chat) =>
      chat.groupId === input.group.id ||
      (chat.botId !== null && chat.botId !== undefined && members.has(chat.botId)),
  );

  const chatIds = new Set(chats.map((chat) => chat.id));

  // A card always names its group, so this space's cards are exactly that group's.
  // Chats fall back to the owner because a bot's own chat carries no group.
  const workItems = input.workItems.filter((item) => item.groupId === input.group.id);

  const bots = input.bots.filter((bot) => members.has(bot.id));

  const capacity = buildCapacity({
    bossBotId: input.group.bossBotId,
    bots,
    chats,
    workItems,
    delegations: input.delegations.filter((delegation) => chatIds.has(delegation.parentThreadId)),
    // The standup names what each bot is on, not how full its context is or how
    // many chats wait behind it; the capacity rows carry those for their own view.
    contextPercentByBotId: new Map<string, number>(),
    queuedByBotId: new Map<string, number>(),
  });

  const names = new Map<string, string>();

  for (const bot of input.bots) names.set(bot.id, bot.name);

  const queued = workItems.filter((item) => QUEUE_STATES.has(item.state)).toSorted(oldestFirst);

  const queue = queued.slice(0, STANDUP_QUEUE_LIMIT).map(
    (item): StandupQueueItem => ({
      id: item.id,
      title: item.title,
      ownerName: item.ownerBotId === undefined ? null : (names.get(item.ownerBotId) ?? null),
    }),
  );

  const blocked = workItems
    .filter((item) => item.state === "blocked")
    .toSorted(oldestFirst)
    .map(
      (item): StandupBlocker => ({
        id: item.id,
        title: item.title,
        owner: blockerOwner(item, names),
        note: item.blockedOn?.note ?? null,
      }),
    );

  const counts = capacity.counts;

  return {
    capacity,
    queue,
    queueTotal: queued.length,
    blocked,
    isQuiet: counts.asking + counts.held + counts.busy === 0 && queued.length === 0,
  };
}
