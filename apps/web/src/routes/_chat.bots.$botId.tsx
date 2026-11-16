import { useAtomValue } from "@effect/atom-react";
import { EnvironmentId } from "@isnadi/contracts";
import { botRoutinesView } from "@isnadi/client-runtime/routines";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { BotThreadLanding } from "../components/roster/BotThreadLanding";
import { BotDetailsPanel } from "../components/roster/BotDetailsPanel";
import { routineDelegateOptions } from "../components/roster/botEngineSelection";
import { useBotThreadRef } from "../components/roster/useBotThreadRef";
import { useRoutineActions } from "../components/roster/useRoutineActions";
import { useThreadShell } from "../state/entities";
import { resolveRoutedBot } from "../components/roster/rosterRouteSelection";
import { useRosterStore } from "../components/roster/rosterStore";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { botRoutePanelKeys } from "./-botRoutePanelKeys";
import { usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerProvidersAtom } from "../state/server";
import { environmentSnapshotAtom } from "../state/shell";

// SAFETY: This sentinel is used only while the environment query is disabled and is never sent to a server.
const NO_ENVIRONMENT = "" as EnvironmentId;

function BotThreadRouteView() {
  const { botId } = Route.useParams();
  const panelKeys = botRoutePanelKeys(botId);
  const navigate = useNavigate();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const providers = useAtomValue(primaryServerProvidersAtom);
  const [routinePanelRequest, setRoutinePanelRequest] = useState(0);
  /*
   * The roster store is not scoped to the active environment, so a bot found by
   * id alone can still belong to the environment we just left. Judging the id
   * only once the store mirrors this environment keeps the panel from showing
   * one environment's bot while its saves address another.
   */
  const bots = useRosterStore((state) => state.bots);
  const rosterEnvironmentId = useRosterStore((state) => state.environmentId);
  const routedBot = resolveRoutedBot(environmentId, rosterEnvironmentId, bots, botId);
  const bot = routedBot.status === "available" ? routedBot.bot : null;
  const threadRef = useBotThreadRef(botId);
  // A remembered chat that no longer loads cannot take a routine.
  const routineThreadRef = useThreadShell(threadRef) ? threadRef : null;

  // A routine can hand its work to any other active bot in this environment.
  // Bots whose provider cannot take handed-off work stay listed but disabled.
  const delegateOptions = useMemo(
    () =>
      bot ? routineDelegateOptions(bot.id, bots, deriveProviderInstanceEntries(providers)) : [],
    [bot, bots, providers],
  );

  const routinesView = useMemo(() => botRoutinesView(snapshot, botId), [botId, snapshot]);
  const routines = routinesView.kind === "ready" ? routinesView.routines : [];

  // A new routine reports back into the bot's own chat, so it can only be created
  // once that thread exists.
  const { busyRoutineId, createRoutine, actions } = useRoutineActions(
    routineThreadRef === null ? null : { botId, threadId: routineThreadRef.threadId },
  );

  return (
    <>
      <BotThreadLanding
        key={panelKeys.thread}
        botId={botId}
        onOpenRoutines={() => setRoutinePanelRequest((request) => request + 1)}
      />
      {bot ? (
        <BotDetailsPanel
          key={panelKeys.details}
          bot={bot}
          threadRef={threadRef}
          routinePanelRequest={routinePanelRequest}
          routinePanel={{
            status: routinesView.kind,
            routines,
            projectOptions: (snapshot?.projects ?? []).map((project) => ({
              id: project.id,
              name: project.title,
            })),
            delegateOptions,
            busyRoutineId,
            createNeedsChat: routineThreadRef === null,
            ...(createRoutine ? { onCreate: createRoutine } : {}),
            ...actions,
          }}
          onOpenSettings={() => {
            void navigate({ to: "/bots/$botId/settings", params: { botId } });
          }}
        />
      ) : null}
    </>
  );
}

export const Route = createFileRoute("/_chat/bots/$botId")({
  component: BotThreadRouteView,
});
