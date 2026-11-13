import { useAtomValue } from "@effect/atom-react";
import {
  buildCapacity,
  type CapacityBot,
  type CapacityRow,
  type CapacityWorkItem,
} from "@isnadi/client-runtime/fleet/capacity";
import { type BotStatusDelegation } from "@isnadi/shared/botStatus";
import {
  isGroupBotMember,
  type EnvironmentId,
  type OrchestrationThreadShell,
  type ScopedThreadRef,
  type ThreadId,
} from "@isnadi/contracts";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { useThreadActivities } from "../../state/entities";
import { environmentSnapshotAtom } from "../../state/shell";
import { cn } from "~/lib/utils";
import { BOT_STATUS_LABEL, BOT_STATUS_TONE } from "./botStatusPresentation";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * Which chats belong to one bot: its own chats and the group chats it answers.
 * A group chat has no owner bot, so the responder is the only bot that can be
 * busy in it — the same rule the status core applies.
 */
function ownerOfChat(chat: OrchestrationThreadShell): string | null {
  return chat.respondingBotId ?? chat.botId ?? null;
}

function newestChatByBot(
  chats: ReadonlyArray<OrchestrationThreadShell>,
): ReadonlyMap<string, OrchestrationThreadShell> {
  const newest = new Map<string, OrchestrationThreadShell>();

  for (const chat of chats) {
    const owner = ownerOfChat(chat);

    if (owner === null || chat.archivedAt !== null) continue;
    const seen = newest.get(owner);

    if (seen === undefined || seen.updatedAt < chat.updatedAt) newest.set(owner, chat);
  }

  return newest;
}

/**
 * One bot's line: what it is doing, the item it is on, how full its context is
 * and whether anyone waits behind it. The context reading comes from that bot's
 * newest chat, which is why each row reads its own activities rather than the
 * group's.
 */
function FleetCapacityRowView({
  environmentId,
  row,
  chatId,
}: {
  readonly environmentId: EnvironmentId;
  readonly row: CapacityRow;
  readonly chatId: ThreadId | null;
}) {
  const { t } = useI18n();

  const ref = useMemo<ScopedThreadRef | null>(
    () => (chatId === null ? null : { environmentId, threadId: chatId }),
    [chatId, environmentId],
  );

  const activities = useThreadActivities(ref);

  const contextPercent =
    chatId === null
      ? null
      : (deriveLatestContextWindowSnapshot(activities)?.usedPercentage ?? null);

  const item = row.item;

  const contextLabel =
    contextPercent === null
      ? "—"
      : t("Context used: {percent}%", { percent: Math.round(contextPercent) });

  return (
    <li
      className="flex min-w-0 items-baseline gap-2 py-0.5 text-sm"
      data-bot-id={row.botId}
      data-status={row.status}
      data-testid="fleet-capacity-row"
    >
      <span className="shrink-0 font-medium text-foreground">{row.name}</span>
      <span className={cn("shrink-0", BOT_STATUS_TONE[row.status])}>
        {t(BOT_STATUS_LABEL[row.status])}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {item === null ? "—" : item.title}
        {item !== null && item.extra > 0 ? (
          <span className="ms-1 tabular-nums text-muted-foreground">{`+${item.extra}`}</span>
        ) : null}
      </span>
      <span
        className="shrink-0 tabular-nums text-muted-foreground"
        {...(contextPercent === null ? {} : { title: contextLabel })}
      >
        {contextPercent === null ? "—" : `${Math.round(contextPercent)}%`}
      </span>
      {row.queued > 0 ? (
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {t("Queued ({count})", { count: row.queued })}
        </span>
      ) : null}
    </li>
  );
}

/**
 * The capacity view of a hired group: one row per bot, boss first, read from the
 * shell snapshot and stream alone, so a client on another machine sees the same
 * rows as the one hosting the environment. A group the user put together by hand
 * has no `fleetTemplateId` and gets the per-bot activity line instead.
 */
export function FleetCapacityView({
  environmentId,
  groupId,
  queuedByBotId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly groupId: string;
  readonly queuedByBotId: ReadonlyMap<string, number>;
}) {
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));

  const capacity = useMemo(() => {
    if (snapshot === null) return null;

    const group = snapshot.groups.find((candidate) => candidate.id === groupId);

    if (group === undefined) return null;

    const memberIds = new Set(group.members.filter(isGroupBotMember).map((member) => member.botId));

    const bots: ReadonlyArray<CapacityBot> = snapshot.bots.filter((bot) => memberIds.has(bot.id));

    // A bot's own chats, plus the group's: a delegated child keeps its bot, so
    // it arrives here with the bot that spawned it.
    const chats: ReadonlyArray<OrchestrationThreadShell> = snapshot.threads.filter(
      (thread) =>
        thread.groupId === group.id ||
        (thread.botId !== null && thread.botId !== undefined && memberIds.has(thread.botId)),
    );

    const chatIds = new Set(chats.map((chat) => chat.id));

    const workItems: ReadonlyArray<CapacityWorkItem> = (snapshot.workItems ?? []).filter(
      (item) => item.ownerBotId !== undefined && memberIds.has(item.ownerBotId),
    );

    const delegations: ReadonlyArray<BotStatusDelegation> = snapshot.delegations.filter(
      (delegation) => chatIds.has(delegation.parentThreadId),
    );

    const built = buildCapacity({
      bossBotId: group.bossBotId,
      bots,
      chats,
      workItems,
      delegations,
      // Each row reads its own bot's context window; the map stays empty here.
      contextPercentByBotId: new Map<string, number>(),
      queuedByBotId,
    });

    return { ...built, newestChat: newestChatByBot(chats) };
  }, [groupId, queuedByBotId, snapshot]);

  if (capacity === null || capacity.rows.length === 0) return null;

  return (
    <ul
      aria-live="polite"
      className="flex w-full min-w-0 flex-col px-3 py-1.5"
      data-testid="fleet-capacity"
    >
      {capacity.rows.map((row) => (
        <FleetCapacityRowView
          chatId={capacity.newestChat.get(row.botId)?.id ?? null}
          environmentId={environmentId ?? NO_ENVIRONMENT}
          key={row.botId}
          row={row}
        />
      ))}
    </ul>
  );
}
