import {
  buildCapacity,
  newestChatByBotId,
  type CapacityBot,
  type CapacityRow,
} from "@isnadi/client-runtime/fleet/capacity";
import type { BotStatus, BotStatusDelegation } from "@isnadi/shared/botStatus";
import {
  isGroupBotMember,
  type EnvironmentId,
  type OrchestrationThreadShell,
  type ScopedThreadRef,
  type ThreadId,
  type WorkItemSummary,
} from "@isnadi/contracts";
import { MoreHorizontalIcon } from "lucide-react";
import { Predicate } from "effect";
import { useMemo, useState, type ComponentProps } from "react";

import { useI18n } from "../../i18n";
import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
} from "../../lib/contextWindow";
import { useThreadActivities } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { useAtomCommand } from "../../state/use-atom-command";
import { workItemEnvironment } from "../../state/workItems";
import { useOpenChat } from "../chat/useOpenChat";
import { BOT_STATUS_LABEL } from "../roster/botStatusPresentation";
import type { Group } from "../roster/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { workItemFailureToast } from "./workItemFailure.logic";

// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/**
 * The badge each state wears. Asking and sign-in are the two states the user has to
 * act on, so they are the only ones that carry a warning colour (E13a `2167:614`).
 */
const STATUS_BADGE_VARIANT: Readonly<Record<BotStatus, ComponentProps<typeof Badge>["variant"]>> = {
  busy: "info",
  asking: "warning",
  idle: "secondary",
  held: "secondary",
  "sign-in-required": "warning",
};

/**
 * One member's line on the Team table: who it is, what it is doing, and how full
 * its context is. The context reading comes from that bot's newest chat, which is
 * why each row reads its own activities rather than the group's.
 */
function TeamRow({
  environmentId,
  row,
  chatId,
  blocked,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly row: CapacityRow;
  readonly chatId: ThreadId | null;
  /** The blocked item this bot owns, when it holds one; the way out of `held`. */
  readonly blocked: WorkItemSummary | null;
}) {
  const { t } = useI18n();
  const openChat = useOpenChat();
  const unblock = useAtomCommand(workItemEnvironment.unblock, { reportFailure: false });
  const [resuming, setResuming] = useState(false);

  const ref = useMemo<ScopedThreadRef | null>(
    () =>
      chatId === null ? null : { environmentId: environmentId ?? NO_ENVIRONMENT, threadId: chatId },
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

  const openAskingChat = () => {
    if (chatId === null || environmentId === null) return;
    void openChat({ environmentId, threadId: chatId });
  };

  const isHeld = row.status === "held";

  // The reason follows the bot's held state, not the card the row happens to
  // show: a bot can hold an older in-progress card and a newer blocked one, and
  // the row shows the older. Reading the note off the held state is what keeps
  // it beside the Resume, so a row never offers the way out without saying why.
  const blockedNote = isHeld ? (blocked?.blockedOn?.note ?? null) : null;

  const resume = async () => {
    if (environmentId === null || blocked === null || resuming) return;

    setResuming(true);

    const result = await unblock({ environmentId, input: { workItemId: blocked.id } });

    setResuming(false);

    if (Predicate.isTagged(result, "Failure")) {
      toastManager.add(
        workItemFailureToast({ cause: result.cause, title: t("Could not update the card") }, t),
      );
    }
  };

  return (
    <tr className="border-t border-border/60" data-bot-id={row.botId} data-status={row.status}>
      <th scope="row" className="py-2 pe-3 text-start align-top font-medium">
        <span className="flex min-w-0 items-center gap-1.5">
          <bdi className="truncate">{row.name}</bdi>
          {row.isBoss ? (
            <Badge size="default" variant="secondary">
              {t("Boss")}
            </Badge>
          ) : null}
        </span>
      </th>
      <td className="py-2 pe-3 align-top">
        <Badge size="default" variant={STATUS_BADGE_VARIANT[row.status]}>
          {/* Two E13 frames name the person being asked, so the table says "Asking you". */}
          {row.status === "asking" ? t("Asking you") : t(BOT_STATUS_LABEL[row.status])}
        </Badge>
      </td>
      <td className="min-w-0 py-2 pe-3 align-top text-sm text-muted-foreground">
        {item === null ? "—" : <bdi className="truncate">{item.title}</bdi>}
        {item !== null && item.extra > 0 ? (
          <span className="ms-1 tabular-nums">{`+${item.extra}`}</span>
        ) : null}
        {/* A held row says what it is waiting on, in the words the block recorded. */}
        {blockedNote === null ? null : <span className="block text-xs">{blockedNote}</span>}
      </td>
      <td
        className="py-2 pe-3 align-top text-sm tabular-nums text-muted-foreground"
        {...(usedPercentage === null
          ? {}
          : { title: t("Context used: {percent}%", { percent: Math.round(usedPercentage) }) })}
      >
        {contextLabel === null ? "—" : contextLabel}
      </td>
      {/* The frame gives every row its action cell: an open on the row that is asking,
          then the row menu's trigger. The menu itself is E13b's. */}
      <td className="py-2 align-top">
        <span className="flex items-center justify-end gap-1">
          {row.status === "asking" && chatId !== null && environmentId !== null ? (
            <Button size="sm" variant="outline" onClick={openAskingChat}>
              {t("Open")}
            </Button>
          ) : null}
          {/* A held bot that owns a blocked card gets the way out; one waiting on a
              delegated child owns no card, so it gets none. */}
          {isHeld && blocked !== null ? (
            <Button
              size="sm"
              variant="outline"
              disabled={resuming}
              onClick={() => {
                void resume();
              }}
            >
              {t("Resume")}
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" aria-label={t("Bot actions")}>
            <MoreHorizontalIcon aria-hidden />
          </Button>
        </span>
      </td>
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

    const workItems: ReadonlyArray<WorkItemSummary> = (snapshot.workItems ?? []).filter(
      (item) => item.ownerBotId !== undefined && memberIds.has(item.ownerBotId),
    );

    // The blocked card each held bot owns, first one per bot. A held bot may own
    // none: waiting on a delegated child blocks nothing, and that row has no way
    // out to offer, so it is absent here rather than null.
    const blockedByBotId = new Map<string, WorkItemSummary>();

    for (const item of workItems) {
      if (item.state !== "blocked" || item.ownerBotId === undefined) continue;

      if (blockedByBotId.has(item.ownerBotId)) continue;

      blockedByBotId.set(item.ownerBotId, item);
    }

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

    return { ...built, newestChat: newestChatByBotId(chats), blockedByBotId };
  }, [group, snapshot]);

  const bossName = capacity?.rows.find((row) => row.isBoss)?.name ?? null;

  return (
    <section className="flex min-w-0 flex-col gap-3" data-testid="space-team">
      {/* decision-73 keeps this header to the title and its one line: no action button. */}
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
                environmentId={environmentId}
                chatId={capacity.newestChat.get(row.botId)?.id ?? null}
                blocked={capacity.blockedByBotId.get(row.botId) ?? null}
                row={row}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
