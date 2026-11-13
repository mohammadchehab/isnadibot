import {
  isIsnadiDelegationTerminal,
  type BotId,
  type IsnadiDelegationRecord,
  type OrchestrationThreadShell,
  type WorkItemSummary,
} from "@isnadi/contracts";

/**
 * What a bot is doing, as the space view shows it. The order of this list is
 * the precedence {@link deriveBotStatus} applies: a bot waiting on its user is
 * not reported as busy just because a turn is still technically running.
 */
export const BOT_STATUSES = ["asking", "held", "busy", "idle"] as const;

export type BotStatus = (typeof BOT_STATUSES)[number];

/**
 * The shell fields a status decision reads. A chat carries nothing else the
 * decision needs, so both the server and a client can answer from the snapshot
 * and stream they already hold.
 */
export type BotStatusChat = Pick<
  OrchestrationThreadShell,
  | "id"
  | "botId"
  | "respondingBotId"
  | "parentThreadId"
  | "archivedAt"
  | "latestTurn"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
>;

export type BotStatusWorkItem = Pick<WorkItemSummary, "ownerBotId" | "state">;

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
 * The four states, in precedence order asking, held, busy, idle:
 *
 * - asking: a pending approval or question anywhere in the bot's chat tree, so
 *   the same rule `selectDecisions` shows the user applies here.
 * - held: the bot owns an item in state `blocked`, or its running turn is
 *   waiting on a delegated child that has not finished. It is not free to take
 *   more work, and it is not working either.
 * - busy: a turn is running.
 * - idle: none of the above.
 *
 * Only chats that are not archived or deleted count; a deleted chat is not in
 * the shell at all. A bot with no chat is idle.
 */
export function deriveBotStatus(input: BotStatusInput): BotStatus {
  const byId = new Map(input.chats.map((chat) => [chat.id, chat]));

  const owns = (chat: BotStatusChat): boolean => {
    if (chat.archivedAt !== null) return false;

    return chatBotId(rootOf(chat, byId)) === input.botId;
  };

  const chats = input.chats.filter(owns);

  if (chats.some((chat) => chat.hasPendingApprovals || chat.hasPendingUserInput)) return "asking";

  const running = chats.filter((chat) => chat.latestTurn?.state === "running");

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

  return running.length > 0 ? "busy" : "idle";
}

/** How many bots are in each state, for a header that wants a total. */
export function countBotStatuses(
  statuses: ReadonlyArray<BotStatus>,
): Readonly<Record<BotStatus, number>> {
  const counts: Record<BotStatus, number> = { asking: 0, held: 0, busy: 0, idle: 0 };

  for (const status of statuses) counts[status] += 1;

  return counts;
}
