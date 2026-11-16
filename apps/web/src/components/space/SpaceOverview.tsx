import type { Decision } from "@isnadi/client-runtime/decisions";
import { presentDelegation } from "@isnadi/client-runtime/delegation-presentation";
import type { IsnadiDelegationRecord, OrchestrationThreadShell } from "@isnadi/contracts";
import { relativeRunTime, routineDateLabel } from "@isnadi/client-runtime/routines";
import {
  SPACE_ACTIVITY_LIMIT,
  spaceActivity,
  spaceDecisions,
  spaceDelegations,
  spaceMembers,
  spaceRoutines,
  spaceUpdatedAt,
  weekStart,
  type SpaceRoutine,
} from "@isnadi/client-runtime/space";
import { spaceStandup } from "@isnadi/client-runtime/space/standup";
import { spaceTaskCounts } from "@isnadi/client-runtime/space/work-items";
import { GroupId } from "@isnadi/contracts";

import { useMemo } from "react";

import { useI18n } from "../../i18n";
import { useSpaceUsage } from "../../state/botUsage";
import { useDecisions } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSnapshot } from "../../state/environmentSnapshot";
import { useEnvironmentQuery } from "../../state/query";
import { workItemEnvironment } from "../../state/workItems";
import { useOpenChat } from "../chat/useOpenChat";
import type { Bot, Group } from "../roster/types";
import { useLocalDay } from "../roster/useLocalDay";
import { useRosterStore } from "../roster/rosterStore";
import { Button } from "../ui/button";
import { SpaceActivityRow, SpaceChatActivityRow } from "./SpaceActivityRow";
import { SpaceStandup } from "./SpaceStandup";
import { SpaceTasks } from "./SpaceTasks";
import { SpaceTeamTable } from "./SpaceTeamTable";
import { SpaceTile } from "./SpaceTile";

const NO_ROUTINES: ReadonlyArray<SpaceRoutine> = [];

const NO_THREADS: ReadonlyArray<OrchestrationThreadShell> = [];

const NO_DELEGATIONS: ReadonlyArray<IsnadiDelegationRecord> = [];

/** The Tasks tile counts the week's done items, so it reads the same page SpaceTasks does. */
const FINISHED_PAGE_SIZE = 50;

/**
 * The space's dashboard. Everything is derived from data the client already holds (the
 * environment's chats, decisions, the routine snapshot, each member's usage window), so it
 * adds no server read model.
 */
export function SpaceOverview({ group }: { group: Group }) {
  const i18n = useI18n();
  const { t, plural } = i18n;
  const environmentId = usePrimaryEnvironmentId();
  const openChat = useOpenChat();
  const bots = useRosterStore((state) => state.bots);
  const allDecisions = useDecisions(environmentId);
  const snapshot = useEnvironmentSnapshot();
  const localDay = useLocalDay();

  const decisions = spaceDecisions(allDecisions, group);
  const routines = spaceRoutines(snapshot?.routines ?? NO_ROUTINES, group);

  const waiting = new Map(decisions.map((decision) => [decision.threadId, decision]));

  // The environment's own chat list, not the sidebar's. The sidebar lists top-level chats
  // only, so reading it here hid every delegation a bot ran for this space.
  const activity = spaceActivity(snapshot?.threads ?? NO_THREADS, group, new Set(waiting.keys()));

  // A delegation and its child chat are the same work, and only the delegation carries the
  // state, so the child chat gives way to the row that says what happened to it.
  const delegations = spaceDelegations(
    snapshot?.delegations ?? NO_DELEGATIONS,
    snapshot?.threads ?? NO_THREADS,
    group,
  );

  const childThreadIds = new Set(
    delegations
      .map((delegation) => presentDelegation(delegation).childThreadId)
      .filter((id) => id !== null),
  );

  const rows = [
    ...activity
      .filter((shell) => !childThreadIds.has(shell.id))
      .map((shell) => ({ kind: "chat" as const, at: shell.updatedAt, shell })),
    ...delegations.map((delegation) => ({
      kind: "delegation" as const,
      at: delegation.updatedAt,
      delegation,
    })),
  ]
    .toSorted((left, right) => right.at.localeCompare(left.at))
    .slice(0, SPACE_ACTIVITY_LIMIT);

  const memberIds = useMemo(() => [...spaceMembers(group)].sort(), [group]);

  const since = useMemo(
    () =>
      weekStart(localDay, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", i18n.locale),
    [localDay, i18n.locale],
  );

  const usage = useSpaceUsage(environmentId, since, memberIds);

  const groupId = GroupId.make(group.id);

  // The shell carries open items only, so the week's done count comes from the
  // finished read — the same query, key and page SpaceTasks issues below.
  const doneQuery = useEnvironmentQuery(
    environmentId === null
      ? null
      : workItemEnvironment.finished({
          environmentId,
          input: { groupId, state: "done", limit: FINISHED_PAGE_SIZE },
        }),
  );

  const taskCounts = useMemo(
    () =>
      spaceTaskCounts(
        [
          ...(snapshot?.workItems ?? []).filter((item) => item.groupId === group.id),
          ...(doneQuery.data?.items ?? []),
        ],
        since,
      ),
    [snapshot?.workItems, doneQuery.data, group.id, since],
  );

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

  const now = Date.now();
  const updated = relativeRunTime(spaceUpdatedAt(group, decisions, activity), now, i18n);
  const botsById = useMemo(() => new Map(bots.map((bot) => [bot.id, bot])), [bots]);

  // The board's line names the boss the way the Team table's does, so it reads the roster.
  const bossName = group.bossBotId === null ? null : (botsById.get(group.bossBotId)?.name ?? null);

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
        {" · "}
        {t("updated {time}", { time: updated })}
      </p>
      {standup === null ? null : <SpaceStandup report={standup} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        <SpaceTile title={t("Tasks")}>
          <p className="text-2xl font-semibold">
            {t("{count} open", { count: i18n.formatNumber(taskCounts.open) })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("{inProgress} in progress · {done} done this week", {
              inProgress: i18n.formatNumber(taskCounts.inProgress),
              done: i18n.formatNumber(taskCounts.doneThisWeek),
            })}
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
      <SpaceTeamTable group={group} />
      {/* The frame splits this row: the board takes the width and Activity keeps a
          fixed 300px column beside it, both 560 tall (E13a `2167:614`). */}
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t("Kanban board")}</h3>
            <p className="text-xs text-muted-foreground">
              {bossName === null
                ? t("Cards move when a bot finishes a step.")
                : t("{name}, the boss, assigns cards. They move when a bot finishes a step.", {
                    name: bossName,
                  })}
            </p>
          </div>
          <div className="flex h-140 min-h-0">
            <SpaceTasks group={group} variant="overview" />
          </div>
        </section>
        <section className="flex h-140 w-full min-w-0 shrink-0 flex-col gap-2 lg:w-75">
          <h3 className="text-sm font-medium">{t("Activity")}</h3>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("Nothing here yet")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {rows.map((row) => {
                  if (row.kind === "delegation") {
                    // Queued delegations have no child yet, and there is no chat to open
                    // without a connected environment.
                    const childThreadId = presentDelegation(row.delegation).childThreadId;

                    return (
                      <SpaceActivityRow
                        key={`delegation-${row.delegation.delegationId}`}
                        delegation={row.delegation}
                        bot={botsById.get(row.delegation.childBotId)}
                        now={now}
                        onReview={
                          childThreadId === null || environmentId === null
                            ? null
                            : () => open({ environmentId, threadId: childThreadId })
                        }
                      />
                    );
                  }

                  const decision = waiting.get(row.shell.id);

                  return (
                    <SpaceChatActivityRow
                      key={row.shell.id}
                      title={row.shell.title}
                      bot={botOf(row.shell)}
                      updatedAt={row.shell.updatedAt}
                      now={now}
                      decision={decision !== undefined}
                      onReview={decision ? () => openDecision(decision) : null}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
