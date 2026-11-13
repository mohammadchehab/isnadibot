import type { Decision } from "@isnadi/client-runtime/decisions";
import { relativeRunTime, routineDateLabel } from "@isnadi/client-runtime/routines";
import {
  spaceActivity,
  spaceDecisions,
  spaceMembers,
  spaceRoutines,
  spaceUpdatedAt,
  weekStart,
  type SpaceRoutine,
} from "@isnadi/client-runtime/space";
import { spaceStandup } from "@isnadi/client-runtime/space/standup";

import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { useSpaceUsage } from "../../state/botUsage";
import { useDecisions, useThreadShells } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { useOpenChat } from "../chat/useOpenChat";
import { BotAvatarView } from "../roster/BotAvatarView";
import type { Bot, Group } from "../roster/types";
import { useLocalDay } from "../roster/useLocalDay";
import { useRosterStore } from "../roster/rosterStore";
import { Button } from "../ui/button";
import { SpaceStandup } from "./SpaceStandup";
import { SpaceTile } from "./SpaceTile";

const NO_ROUTINES: ReadonlyArray<SpaceRoutine> = [];

/**
 * The space's dashboard. Everything is derived from data the client already holds (chat
 * shells, decisions, the routine snapshot, each member's usage window), so it adds no
 * server read model.
 */
export function SpaceOverview({ group }: { group: Group }) {
  const i18n = useI18n();
  const { t, plural } = i18n;
  const environmentId = usePrimaryEnvironmentId();
  const openChat = useOpenChat();
  const bots = useRosterStore((state) => state.bots);
  const shells = useThreadShells();
  const allDecisions = useDecisions(environmentId);
  const snapshot = useEnvironmentSnapshot();
  const localDay = useLocalDay();

  const decisions = spaceDecisions(allDecisions, group);
  const routines = spaceRoutines(snapshot?.routines ?? NO_ROUTINES, group);

  const waiting = new Map(decisions.map((decision) => [decision.threadId, decision]));

  const activity = spaceActivity(
    shells.filter((shell) => shell.environmentId === environmentId),
    group,
    new Set(waiting.keys()),
  );

  const memberIds = useMemo(() => [...spaceMembers(group)].sort(), [group]);

  const since = useMemo(
    () =>
      weekStart(localDay, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", i18n.locale),
    [localDay, i18n.locale],
  );

  const usage = useSpaceUsage(environmentId, since, memberIds);

  const standup = useMemo(
    () =>
      snapshot === null
        ? null
        : spaceStandup({
            group,
            bots: snapshot.bots,
            chats: snapshot.threads,
            workItems: snapshot.workItems ?? [],
            delegations: snapshot.delegations,
          }),
    [group, snapshot],
  );

  const updated = relativeRunTime(spaceUpdatedAt(group, decisions, activity), Date.now(), i18n);
  const boss = bots.find((bot) => bot.id === group.bossBotId);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  const open = (chat: { environmentId: string; threadId: string }) => void openChat(chat);

  const openDecision = (decision: Decision) =>
    open({ environmentId: decision.environmentId, threadId: decision.targetThreadId });

  const newest = decisions[0];

  const botOf = (shell: { botId?: string | null | undefined }): Bot | undefined =>
    shell.botId == null ? undefined : botsById.get(shell.botId);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      data-testid="space-overview"
    >
      <p className="text-sm text-muted-foreground">
        {t("Dashboard")}
        {boss ? <bdi> · {t("Published by {name}", { name: boss.name })}</bdi> : null}
        {" · "}
        {t("updated {time}", { time: updated })}
      </p>
      {standup === null ? null : <SpaceStandup report={standup} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <SpaceTile title={t("Decisions")}>
          {decisions.length === 0 ? (
            <p className="text-sm">{t("Nothing waiting on you")}</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">{decisions.length}</p>
              <Button presentation="decision-line" onClick={() => newest && openDecision(newest)}>
                <bdi className="truncate">{newest?.title}</bdi>
              </Button>
            </>
          )}
        </SpaceTile>
        <SpaceTile title={t("Routines")}>
          <p className="text-2xl font-semibold">
            {t("{count} active", { count: i18n.formatNumber(routines.active) })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Next run")}: {routineDateLabel(routines.nextRunAt, i18n)}
          </p>
        </SpaceTile>
        <SpaceTile title={t("Usage")}>
          <p className="text-2xl font-semibold">
            {usage.isPending
              ? "…"
              : plural(usage.turns, { one: "{count} turn", other: "{count} turns" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {usage.hasError ? t("Some bots could not report usage") : t("this week")}
          </p>
        </SpaceTile>
      </div>
      <SpaceTile title={t("Activity")}>
        {activity.length === 0 ? (
          <p className="text-sm">{t("Nothing here yet")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {activity.map((shell) => {
              const bot = botOf(shell);
              const decision = waiting.get(shell.id);

              return (
                <li key={shell.id} className="flex items-center gap-2 py-2">
                  {bot ? (
                    <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-6" />
                  ) : null}
                  <div className="flex min-w-0 flex-1 flex-col">
                    {bot ? (
                      <span className="truncate text-xs text-muted-foreground">
                        <bdi>{bot.name}</bdi>
                      </span>
                    ) : null}
                    <bdi className="truncate text-sm">{shell.title}</bdi>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeRunTime(shell.updatedAt, Date.now(), i18n)}
                  </span>
                  {decision ? (
                    <Button size="xs" variant="outline" onClick={() => openDecision(decision)}>
                      {t("Review")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SpaceTile>
    </div>
  );
}
