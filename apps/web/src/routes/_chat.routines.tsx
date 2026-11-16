import { useMemo, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { environmentRoutinesView } from "@isnadi/client-runtime/routines";
import { createFileRoute } from "@tanstack/react-router";
import { Clock3Icon } from "lucide-react";

import { PageTopBar } from "../components/PageTopBar";
import { routineDelegateOptions } from "../components/roster/botEngineSelection";
import { RoutineList } from "../components/roster/RoutineList";
import { useRosterStore } from "../components/roster/rosterStore";
import { useRoutineActions } from "../components/roster/useRoutineActions";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useI18n } from "../i18n";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { useEnvironmentSnapshot } from "../state/environmentSnapshot";
import { primaryServerProvidersAtom } from "../state/server";

/**
 * The sidebar's Routines row lands here: every bot's routines in one column, each
 * card saying whose routine it is, and a card opening in place of the list.
 */
function RoutinesRouteView() {
  const { t } = useI18n();
  const snapshot = useEnvironmentSnapshot();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const bots = useRosterStore((state) => state.bots);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const { busyRoutineId, actions } = useRoutineActions();
  const view = useMemo(() => environmentRoutinesView(snapshot), [snapshot]);
  // An environment that predates routines cannot list them; the page says so
  // rather than claiming there are none.
  const status = view.kind === "unavailable" ? "error" : view.kind;
  const routines = view.kind === "ready" ? view.routines : [];

  const projectOptions = useMemo(
    () => (snapshot?.projects ?? []).map((project) => ({ id: project.id, name: project.title })),
    [snapshot?.projects],
  );

  const instanceEntries = useMemo(() => deriveProviderInstanceEntries(providers), [providers]);

  const botNameOf = (botId: string) => {
    const bot = bots.find((candidate) => candidate.id === botId);

    return bot?.name ?? t("Unknown bot");
  };

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTopBar title={t("Routines")} titleRef={titleRef} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-6">
          <div className="mx-auto flex w-(--spacing-min-45rem-pct-2rem) flex-1 flex-col">
            <RoutineList
              status={status}
              routines={routines}
              projectOptions={projectOptions}
              delegateOptionsOf={(routine) =>
                routineDelegateOptions(routine.botId, bots, instanceEntries)
              }
              botNameOf={(routine) => botNameOf(routine.botId)}
              namesOwner
              loadingLabel={t("Loading routines")}
              busyRoutineId={busyRoutineId}
              returnFocusRef={titleRef}
              empty={
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
              }
              {...actions}
            />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/routines")({
  component: RoutinesRouteView,
});
