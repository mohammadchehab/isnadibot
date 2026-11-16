import {
  buildCapacity,
  newestChatByBotId,
  type CapacityBot,
  type CapacityRow,
  type CapacityWorkItem,
} from "@isnadi/client-runtime/fleet/capacity";
import type { BotStatusDelegation } from "@isnadi/shared/botStatus";
import {
  isGroupBotMember,
  type EnvironmentId,
  type OrchestrationThreadShell,
  type ScopedThreadRef,
  type ThreadId,
} from "@isnadi/contracts";
import { useMemo } from "react";

import { useI18n } from "../../i18n";
import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "../../lib/contextWindow";
import { useThreadActivities } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { BOT_STATUS_LABEL, BOT_STATUS_TONE } from "../roster/botStatusPresentation";
import { useGroupDetailsOpen } from "../roster/detailsPanelOpen";
import type { Group } from "../roster/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "~/lib/utils";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * One member's line on the Team table: who it is, what it is doing, and how full
 * its context is. The context reading comes from that bot's newest chat, which is
 * why each row reads its own activities rather than the group's.
 */
function TeamRow({
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

  const context = chatId === null ? null : deriveLatestContextWindowSnapshot(activities);

  // The frames draw the reading as "82k of 200k" rather than a percentage: it is the
  // form in which "hands off after this card" reads as a size (designer ruling).
  const usedTokens = context?.usedTokens ?? null;
  const maxTokens = context?.maxTokens ?? null;
  const usedPercentage = context?.usedPercentage ?? null;

  const contextLabel =
    usedTokens === null
      ? null
      : maxTokens === null
        ? formatContextWindowTokens(usedTokens)
        : `${formatContextWindowTokens(usedTokens)} of ${formatContextWindowTokens(maxTokens)}`;

  const item = row.item;

  return (
    <tr className="border-t border-border/60" data-bot-id={row.botId} data-status={row.status}>
      <th scope="row" className="py-2 pe-3 text-start align-top font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          <bdi className="truncate">{row.name}</bdi>
          {row.isBoss ? (
            <Badge size="sm" variant="quiet">
              {t("Boss")}
            </Badge>
          ) : null}
        </span>
      </th>
      <td className={cn("py-2 pe-3 align-top text-sm", BOT_STATUS_TONE[row.status])}>
        {/* Two E13 frames name the person being asked, so the table says "Asking you". */}
        {row.status === "asking" ? t("Asking you") : t(BOT_STATUS_LABEL[row.status])}
      </td>
      <td className="min-w-0 py-2 pe-3 align-top text-sm text-muted-foreground">
        {item === null ? "—" : <bdi className="truncate">{item.title}</bdi>}
        {item !== null && item.extra > 0 ? (
          <span className="ms-1 tabular-nums">{`+${item.extra}`}</span>
        ) : null}
      </td>
      <td
        className="py-2 pe-3 align-top text-sm tabular-nums text-muted-foreground"
        {...(usedPercentage === null
          ? {}
          : { title: t("Context used: {percent}%", { percent: Math.round(usedPercentage) }) })}
      >
        {contextLabel === null ? "—" : contextLabel}
      </td>
      {/* The frame keeps this cell for a row action; it is empty until one exists. */}
      <td className="py-2 align-top" />
    </tr>
  );
}

/**
 * The space's Team table: the boss first, then the rest of the roster, each with
 * the state, the item it is on and its context reading. Everything comes from the
 * shell snapshot and stream, so a client on another machine sees the same rows.
 */
export function SpaceTeamTable({ group }: { group: Group }) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useEnvironmentSnapshot();
  const [, setDetailsOpen] = useGroupDetailsOpen();

  const capacity = useMemo(() => {
    if (snapshot === null) return null;

    const memberIds = new Set(group.members.filter(isGroupBotMember).map((member) => member.botId));

    const bots: ReadonlyArray<CapacityBot> = snapshot.bots.filter((bot) => memberIds.has(bot.id));

    // A bot's own chats, plus the group's: a delegated child keeps its bot, so it
    // arrives here with the bot that spawned it.
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
      queuedByBotId: new Map<string, number>(),
    });

    return { ...built, newestChat: newestChatByBotId(chats) };
  }, [group, snapshot]);

  const bossName = capacity?.rows.find((row) => row.isBoss)?.name ?? null;

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="space-team">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t("Team")}</h3>
          <p className="text-sm text-muted-foreground">
            {bossName === null
              ? t("Cards go to a bot when it goes idle.")
              : t(
                  "{name}, the boss, assigns from the board. When a bot goes idle, the next card goes to it.",
                  {
                    name: bossName,
                  },
                )}
          </p>
        </div>
        <Button size="xs" variant="outline" onClick={() => setDetailsOpen(true)}>
          {t("Add a bot")}
        </Button>
      </div>
      {capacity === null || capacity.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No bots in this space yet")}</p>
      ) : (
        <table className="w-full text-start">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="pb-1 pe-3 text-start font-medium">
                {t("Bot")}
              </th>
              <th scope="col" className="pb-1 pe-3 text-start font-medium">
                {t("Status")}
              </th>
              <th scope="col" className="pb-1 pe-3 text-start font-medium">
                {t("Working on")}
              </th>
              <th scope="col" className="pb-1 pe-3 text-start font-medium">
                {t("Context")}
              </th>
              <th scope="col" className="pb-1" />
            </tr>
          </thead>
          <tbody>
            {capacity.rows.map((row) => (
              <TeamRow
                key={row.botId}
                environmentId={environmentId ?? NO_ENVIRONMENT}
                chatId={capacity.newestChat.get(row.botId)?.id ?? null}
                row={row}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
