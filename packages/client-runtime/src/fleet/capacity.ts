import {
  type BotStatus,
  type BotStatusChat,
  type BotStatusDelegation,
  countBotStatuses,
  deriveBotStatus,
} from "@isnadi/shared/botStatus";
import type { BotId, WorkItemSummary } from "@isnadi/contracts";

/**
 * The capacity view's data: one row per bot in a fleet group, boss first, built
 * from what the shell snapshot and stream already carry. Nothing here reads a
 * file, a provider or another environment, so a client on another machine sees
 * the same rows.
 */

/** A bot member of the group, as the roster lists it. Archived bots get no row. */
export interface CapacityBot {
  readonly id: BotId;
  readonly name: string;
  readonly archivedAt: string | null;
}

/** The work-item fields a row reads. The group's items are already scoped by the caller. */
export type CapacityWorkItem = Pick<
  WorkItemSummary,
  "id" | "title" | "state" | "ownerBotId" | "createdAt"
>;

export interface CapacityInput {
  /**
   * The group's current boss, which sorts first. Taken unbranded because it comes
   * off the group a client holds; it is only ever compared with a bot's id.
   */
  readonly bossBotId: string | null;
  readonly bots: ReadonlyArray<CapacityBot>;
  /** The chats of every bot in the group, from the shell snapshot. */
  readonly chats: ReadonlyArray<BotStatusChat>;
  readonly workItems: ReadonlyArray<CapacityWorkItem>;
  readonly delegations: ReadonlyArray<BotStatusDelegation>;
  /**
   * Each bot's used share of its context window, 0–100, taken from the latest
   * `context-window.updated` in its chat. A bot with no such activity is absent.
   */
  readonly contextPercentByBotId: ReadonlyMap<string, number>;
  /** How many chats wait in each bot's responder queue. Absent means none. */
  readonly queuedByBotId: ReadonlyMap<string, number>;
}

/** The item a bot is on, and how many other open items it still holds. */
export interface CapacityOpenItem {
  readonly id: string;
  readonly title: string;
  readonly extra: number;
}

export interface CapacityRow {
  readonly botId: BotId;
  readonly name: string;
  readonly isBoss: boolean;
  readonly status: BotStatus;
  /** Null when the bot holds no open item; the view shows an em dash for it. */
  readonly item: CapacityOpenItem | null;
  /** Null when the bot has no context-window reading; the view shows an em dash. */
  readonly contextPercent: number | null;
  readonly queued: number;
}

export interface Capacity {
  readonly rows: ReadonlyArray<CapacityRow>;
  /** Rows per state, for a header that wants a total. */
  readonly counts: Readonly<Record<BotStatus, number>>;
}

const OPEN_ITEM_STATES: ReadonlySet<string> = new Set([
  "queued",
  "assigned",
  "in-progress",
  "blocked",
  "review",
]);

/** The states a bot is on right now, before falling back to what it was assigned. */
const ACTIVE_ITEM_STATES: ReadonlySet<string> = new Set(["in-progress", "blocked"]);

/**
 * The item to show for a bot: the one it is on, otherwise the oldest one it was
 * assigned, with a count of the rest. An item still `blocked` wins the row
 * because it is what makes the bot `held`.
 */
function openItemFor(
  botId: BotId,
  workItems: ReadonlyArray<CapacityWorkItem>,
): CapacityOpenItem | null {
  const open = workItems
    .filter((item) => item.ownerBotId === botId && OPEN_ITEM_STATES.has(item.state))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  if (open.length === 0) return null;

  const active = open.find((item) => ACTIVE_ITEM_STATES.has(item.state));
  const shown = active ?? open[0]!;

  return { id: shown.id, title: shown.title, extra: open.length - 1 };
}

/**
 * One row per bot member of the group, the boss first and the rest in roster
 * order. A bot's state comes from `deriveBotStatus`, so every surface reads the
 * same precedence: asking, held, busy, idle.
 *
 * The caller scopes the input to one group in one environment: its bots, its
 * chats, its items and its delegations. A bot from another environment never
 * reaches this function, which is what keeps the rows honest on a remote client.
 */
export function buildCapacity(input: CapacityInput): Capacity {
  const members = input.bots.filter((bot) => bot.archivedAt === null);

  const boss = members.find((bot) => bot.id === input.bossBotId) ?? null;
  const rest = members.filter((bot) => bot !== boss);
  const ordered = boss === null ? rest : [boss, ...rest];

  const rows = ordered.map(
    (bot): CapacityRow => ({
      botId: bot.id,
      name: bot.name,
      isBoss: bot === boss,
      status: deriveBotStatus({
        botId: bot.id,
        chats: input.chats,
        workItems: input.workItems,
        delegations: input.delegations,
      }),
      item: openItemFor(bot.id, input.workItems),
      contextPercent: input.contextPercentByBotId.get(bot.id) ?? null,
      queued: input.queuedByBotId.get(bot.id) ?? 0,
    }),
  );

  return { rows, counts: countBotStatuses(rows.map((row) => row.status)) };
}
