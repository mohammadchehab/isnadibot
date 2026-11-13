import {
  isIsnadiDelegationTerminal,
  type BotId,
  type IsnadiDelegationRecord,
  type IsoDateTime,
  type OrchestrationSessionStatus,
  type OrchestrationThreadShell,
  type WorkItemSummary,
} from "@isnadi/contracts";

import {
  providerReasonNeedsSignIn,
  type ProviderAvailabilityReason,
} from "./fleet/providerAvailability.ts";

/**
 * What a bot is doing, as the space view shows it. The order of this list is
 * the precedence {@link deriveBotStatus} applies: a bot waiting on its user is
 * not reported as busy just because a turn is still technically running, and a
 * bot that cannot sign in is not reported as busy either.
 */
export const BOT_STATUSES = ["asking", "sign-in-required", "held", "busy", "idle"] as const;

export type BotStatus = (typeof BOT_STATUSES)[number];

/**
 * The shell fields a status decision reads. A chat carries nothing else the
 * decision needs, so both the server and a client can answer from the snapshot
 * and stream they already hold.
 */
export type BotStatusChat = Pick<
  OrchestrationThreadShell,
  "id" | "botId" | "respondingBotId" | "parentThreadId" | "archivedAt" | "latestTurn" | "session"
> & {
  /** Absent reads as nothing pending: only the command read model may omit it. */
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
};

export type BotStatusWorkItem = Pick<WorkItemSummary, "ownerBotId" | "state">;

/**
 * Whether a session still owes its bot work. A turn is in flight from the moment
 * the provider starts answering, which is before the turn itself reports running.
 */
export function isLiveSessionStatus(status: OrchestrationSessionStatus): boolean {
  return status === "starting" || status === "running";
}

export type BotStatusDelegation = Pick<IsnadiDelegationRecord, "parentThreadId" | "phase">;

export interface BotStatusInput {
  readonly botId: BotId;
  readonly chats: ReadonlyArray<BotStatusChat>;
  readonly workItems: ReadonlyArray<BotStatusWorkItem>;
  /** Delegated children, so a turn that waits on them reads as held rather than busy. */
  readonly delegations: ReadonlyArray<BotStatusDelegation>;
}

/**
 * The bot a chat speaks for while it has work: the one responding in it, or the
 * one that owns it. A group chat has no owner bot, so its current responder is
 * the only bot that can be busy in it.
 */
function chatBotId(chat: BotStatusChat): BotId | null {
  return chat.respondingBotId ?? chat.botId ?? null;
}

/**
 * The chat a delegated sub-chat belongs to. A sub-chat is a chat of its root's
 * bot, which is what makes a bot's status cover its whole tree.
 */
function rootOf(chat: BotStatusChat, byId: ReadonlyMap<string, BotStatusChat>): BotStatusChat {
  const seen = new Set<string>();
  let current = chat;

  while (current.parentThreadId !== null && current.parentThreadId !== undefined) {
    if (seen.has(current.id)) return current;

    seen.add(current.id);

    const parent = byId.get(current.parentThreadId);

    if (parent === undefined) return current;

    current = parent;
  }

  return current;
}

/**
 * Why a chat's last contact with its provider left the bot unable to run, or
 * undefined when it did run. A turn that died says so on the turn; a session
 * that never got a turn off the ground says so on the session. Nothing else
 * counts: a turn that resumed drops these on purpose, so this never rebuilds a
 * stale reason out of history.
 */
function unavailability(chat: BotStatusChat): ProviderAvailabilityReason | undefined {
  if (chat.latestTurn?.state === "error") {
    return chat.latestTurn.unavailability ?? chat.session?.unavailability;
  }

  return chat.session?.status === "error" ? chat.session.unavailability : undefined;
}

/** Whether signing in is the one fix for a chat, rather than a transient failure. */
function needsSignIn(chat: BotStatusChat): boolean {
  return providerReasonNeedsSignIn(unavailability(chat));
}

/**
 * The chats that speak for a bot: its own and its sub-chats, minus the archived
 * ones. Both status and idle time read the same set, so the two never disagree
 * about which chats a bot has.
 */
function ownedChats(input: BotStatusInput): ReadonlyArray<BotStatusChat> {
  const byId = new Map(input.chats.map((chat) => [chat.id, chat]));

  return input.chats.filter(
    (chat) => chat.archivedAt === null && chatBotId(rootOf(chat, byId)) === input.botId,
  );
}

/**
 * The five states, in precedence order asking, sign-in-required, held, busy,
 * idle:
 *
 * - asking: a pending approval or question anywhere in the bot's chat tree, so
 *   the same rule `selectDecisions` shows the user applies here.
 * - sign-in-required: the bot is not running anything and one of its chats
 *   cannot start because its provider needs signing in. Only the user can clear
 *   it, so it is worth their attention the way `asking` is.
 * - held: the bot owns an item in state `blocked`, or its running turn is
 *   waiting on a delegated child that has not finished. It is not free to take
 *   more work, and it is not working either.
 * - busy: a turn is running, a session is still starting or running for one of
 *   its chats, or it owns an item in `assigned` or `in-progress` — the bot has
 *   been given work and has not finished it.
 * - idle: none of the above.
 *
 * Only chats that are not archived or deleted count; a deleted chat is not in
 * the shell at all. A bot with no chat is idle.
 */
export function deriveBotStatus(input: BotStatusInput): BotStatus {
  const chats = ownedChats(input);

  if (chats.some((chat) => chat.hasPendingApprovals === true || chat.hasPendingUserInput === true))
    return "asking";

  const running = chats.filter((chat) => chat.latestTurn?.state === "running");

  // A bot with a turn in flight is working, not stuck at a login screen.
  if (running.length === 0 && chats.some(needsSignIn)) return "sign-in-required";

  const blockedItem = input.workItems.some(
    (item) => item.ownerBotId === input.botId && item.state === "blocked",
  );

  const waitingOnChildren = running.some((chat) =>
    input.delegations.some(
      (delegation) =>
        delegation.parentThreadId === chat.id && !isIsnadiDelegationTerminal(delegation.phase),
    ),
  );

  if (blockedItem || waitingOnChildren) return "held";

  const workingItem = input.workItems.some(
    (item) =>
      item.ownerBotId === input.botId &&
      (item.state === "assigned" || item.state === "in-progress"),
  );

  const liveSession = chats.some(
    (chat) => chat.session !== null && isLiveSessionStatus(chat.session.status),
  );

  return running.length > 0 || workingItem || liveSession ? "busy" : "idle";
}

/**
 * When the bot last stopped working: the moment its most recent turn finished, or
 * the moment that turn started when it has not finished yet.
 *
 * A bot that never had a turn returns null. A caller that orders bots by who is
 * free reads null as the most idle of all, so a freshly hired bot takes the next
 * item before a bot that has been sitting since this morning.
 *
 * Only the chats {@link deriveBotStatus} attributes to the bot count, so a group
 * chat speaks for the bot responding in it. Nothing here reads a turn's outcome:
 * a turn that ended in an error still ends, and the bot is free again.
 */
export function idleSince(input: BotStatusInput): IsoDateTime | null {
  return ownedChats(input).reduce<IsoDateTime | null>((latest, chat) => {
    const turn = chat.latestTurn;

    if (turn === null || turn === undefined) return latest;

    const at = turn.completedAt ?? turn.startedAt ?? turn.requestedAt;

    return latest === null || at > latest ? at : latest;
  }, null);
}

/** How many bots are in each state, for a header that wants a total. */
export function countBotStatuses(
  statuses: ReadonlyArray<BotStatus>,
): Readonly<Record<BotStatus, number>> {
  const counts: Record<BotStatus, number> = {
    asking: 0,
    "sign-in-required": 0,
    held: 0,
    busy: 0,
    idle: 0,
  };

  for (const status of statuses) counts[status] += 1;

  return counts;
}
