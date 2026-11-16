import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock3Icon } from "lucide-react";

import { BotAvatarView } from "../components/roster/BotAvatarView";
import { formatRosterTimestamp } from "../components/roster/roster.logic";
import { useRosterStore } from "../components/roster/rosterStore";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useClientSettings } from "../hooks/useSettings";
import { useI18n } from "../i18n";
import { useEnvironmentSnapshot } from "../state/environmentSnapshot";

/**
 * The sidebar's Routines row lands here. The page is the routines list lifted
 * off the sidebar, so a drawn page frame (TASK-423) can replace it without the
 * row changing where it goes.
 */
function RoutinesRouteView() {
  const navigate = useNavigate();
  const snapshot = useEnvironmentSnapshot();
  const bots = useRosterStore((state) => state.bots);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const { t } = useI18n();
  const routines = (snapshot?.routines ?? []).filter((routine) => routine.lifecycle !== "deleted");

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <span className="text-sm font-medium text-muted-foreground">{t("Routines")}</span>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          {routines.length === 0 ? (
            <Empty className="flex-1">
              <EmptyHeader className="max-w-md">
                <EmptyMedia variant="icon">
                  <Clock3Icon />
                </EmptyMedia>
                <EmptyTitle>{t("No routines yet")}</EmptyTitle>
                <EmptyDescription className="mt-2 leading-relaxed">
                  {t("Ask a bot to do something on a schedule.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="mx-auto flex w-full max-w-3xl flex-col gap-0.5 px-2">
              {routines.map((routine) => {
                const bot = bots.find((candidate) => candidate.id === routine.botId);

                const time = routine.nextRunAt
                  ? formatRosterTimestamp(routine.nextRunAt, timestampFormat)
                  : null;

                const when = !routine.enabled
                  ? t("Paused")
                  : time
                    ? t("Next {time}", { time })
                    : t("Not scheduled");

                return (
                  <li key={routine.id}>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: "/bots/$botId", params: { botId: routine.botId } })
                      }
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-start outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {bot ? (
                        <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-9" />
                      ) : null}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          <bdi>{routine.job}</bdi>
                        </span>
                        <span className="truncate text-13px text-muted-foreground">
                          <bdi>{`${bot?.name ?? t("Unknown bot")} · ${when}`}</bdi>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/routines")({
  component: RoutinesRouteView,
});
