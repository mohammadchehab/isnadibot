import { useAtomValue } from "@effect/atom-react";
import { Predicate } from "effect";
import { BotId, ProjectId, RoutineId, readyMadeBot } from "@isnadi/contracts";
import { readyMadeRoutineDraft } from "@isnadi/client-runtime/fleet/ready-made-bot";
import type { ReadyMadeBotId } from "@isnadi/contracts";
import type { RoutineAdapterSchedule } from "@isnadi/client-runtime/routines";
import { useCallback, useRef, useState } from "react";

import { usePrimarySettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { newThreadId, randomUUID } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../modelSelection";
import { botEnvironment } from "../../state/bots";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { routineEnvironment } from "../../state/routines";
import { primaryServerProvidersAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE } from "../../types";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { toastManager } from "../ui/toast";
import { DEFAULT_BOT_RUNTIME_MODE } from "./botSandbox";
import type { BotAvatar } from "./types";

/** What the ready-made form collected for the bot's first routine. */
export interface ReadyMadeBotInput {
  readonly presetId: ReadyMadeBotId;
  /** A folder in the bot's project, or an http(s) URL. */
  readonly target: string;
  readonly schedule: RoutineAdapterSchedule;
}

export interface NewBotInput {
  readonly name: string;
  readonly avatar: BotAvatar;
  /** Set when the user added a ready-made bot instead of starting from scratch. */
  readonly readyMade?: ReadyMadeBotInput;
}

/**
 * Creates a bot, and for a ready-made one its first chat and the routine draft the
 * user approves. The bot lands even when those later steps fail: a created bot with
 * no routine is recoverable, a half-created roster entry is not.
 */
export function useNewBotCreate() {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threadShells = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const settings = usePrimarySettings();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createBotCommand = useAtomCommand(botEnvironment.create, { reportFailure: false });
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const draftRoutine = useAtomCommand(routineEnvironment.draft, { reportFailure: false });
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);

  const defaultProject =
    bootstrapped && environmentId !== null
      ? (sortScopedProjectsForSidebar(
          projects.filter((project) => project.environmentId === environmentId),
          threadShells,
          "updated_at",
        )[0] ?? null)
      : null;

  const startReadyMadeRoutine = useCallback(
    async (botId: BotId, input: ReadyMadeBotInput) => {
      if (environmentId === null) return false;
      const preset = readyMadeBot(input.presetId);

      if (!preset) return false;

      if (defaultProject === null) {
        toastManager.add({
          type: "error",
          title: t("Add a project to this environment before creating a routine."),
        });

        return false;
      }

      const draft = readyMadeRoutineDraft(preset, {
        target: input.target,
        schedule: input.schedule,
      });

      const threadId = newThreadId();

      const threadResult = await createThread({
        environmentId,
        input: {
          threadId,
          projectId: defaultProject.id,
          botId,
          title: draft.job,
          modelSelection:
            defaultProject.defaultModelSelection ??
            resolveAppModelSelectionState(settings, providers),
          runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
          interactionMode: DEFAULT_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
          createdAt: new Date().toISOString(),
        },
      });

      if (Predicate.isTagged(threadResult, "Failure")) {
        toastManager.add({ type: "error", title: t("Could not start chat") });

        return false;
      }

      const routineResult = await draftRoutine({
        environmentId,
        input: {
          routineId: RoutineId.make(randomUUID()),
          targetThreadId: threadId,
          botId,
          job: draft.job,
          procedure: draft.procedure,
          schedule: draft.schedule,
          timezone: draft.timezone,
          skillAssignmentIds: [],
          connectorDependencies: [],
          projectId: ProjectId.make(defaultProject.id),
          sandbox: "local",
          approvalPolicy: "approval-required",
          delegateToBotId: null,
          createdAt: new Date().toISOString(),
        },
      });

      if (Predicate.isTagged(routineResult, "Failure")) {
        toastManager.add({ type: "error", title: t("Could not create routine") });

        return false;
      }

      return true;
    },
    [createThread, defaultProject, draftRoutine, environmentId, providers, settings, t],
  );

  const createBot = useCallback(
    async (input: NewBotInput): Promise<BotId | null> => {
      // A second submit before the first resolves would create a second bot.
      if (creatingRef.current) return null;

      if (environmentId === null) {
        toastManager.add({ type: "error", title: t("Connect an environment first") });

        return null;
      }

      creatingRef.current = true;
      setCreating(true);

      try {
        const botId = BotId.make(`bot-${randomUUID()}`);

        const result = await createBotCommand({
          environmentId,
          input: {
            botId,
            name: input.name.trim(),
            title: "Assistant",
            label: null,
            description: null,
            avatar: input.avatar,
            engine: null,
            sandbox: null,
            runtimeMode: DEFAULT_BOT_RUNTIME_MODE,
            groupId: null,
          },
        });

        if (Predicate.isTagged(result, "Failure")) {
          toastManager.add({ type: "error", title: t("Could not create bot") });

          return null;
        }

        if (input.readyMade) await startReadyMadeRoutine(botId, input.readyMade);

        return botId;
      } finally {
        creatingRef.current = false;
        setCreating(false);
      }
    },
    [createBotCommand, environmentId, startReadyMadeRoutine, t],
  );

  return { creating, createBot };
}
