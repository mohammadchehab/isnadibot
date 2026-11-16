import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  BotId,
  EnvironmentId,
  McpServerId,
  ProjectId,
  RoutineId,
  RoutineRunId,
  SkillAssignmentId,
  SkillId,
  type ThreadId,
} from "@isnadi/contracts";
import { toRoutineSchedule, type RoutineAdapterDraft } from "@isnadi/client-runtime/routines";
import type { AtomCommandResult } from "@isnadi/client-runtime/state/runtime";

import { useI18n } from "../../i18n";
import { hasTag } from "../../lib/taggedUnion";
import { randomUUID } from "../../lib/utils";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { routineEnvironment } from "../../state/routines";
import { primaryServerProvidersAtom } from "../../state/server";
import { environmentSnapshotAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import { routineFailureToast } from "./routineFailure.logic";
import { useRosterStore } from "./rosterStore";

// SAFETY: This sentinel is used only while the environment query is disabled and is never sent to a server.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** The bot a new routine belongs to, and the chat it reports back into. */
export interface RoutineCreationTarget {
  readonly botId: string;
  readonly threadId: ThreadId;
}

/** Every routine command a list can raise, each reporting its own failure. */
export interface RoutineActions {
  readonly onUpdate: (routineId: string, draft: RoutineAdapterDraft) => Promise<void>;
  readonly onDelete: (routineId: string) => Promise<void>;
  readonly onApproveProcedure: (routineId: string) => void;
  readonly onDryRun: (routineId: string) => void;
  readonly onRunNow: (routineId: string) => void;
  readonly onSetEnabled: (routineId: string, enabled: boolean) => void;
  readonly onSetPaused: (routineId: string, paused: boolean) => void;
}

/**
 * The routine commands, wired once for both lists: the bot panel's and the page that
 * spans every bot. Each command resolves the routine — and so the bot that owns it —
 * from the environment snapshot rather than from whatever bot the surface was opened on.
 */
export function useRoutineActions(create: RoutineCreationTarget | null = null) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const snapshot = useAtomValue(environmentSnapshotAtom(environmentId ?? NO_ENVIRONMENT));
  const providers = useAtomValue(primaryServerProvidersAtom);
  const bots = useRosterStore((state) => state.bots);
  const draftRoutine = useAtomCommand(routineEnvironment.draft, { reportFailure: false });
  const approveRoutine = useAtomCommand(routineEnvironment.approve, { reportFailure: false });
  const enableRoutine = useAtomCommand(routineEnvironment.enable, { reportFailure: false });
  const pauseRoutine = useAtomCommand(routineEnvironment.pause, { reportFailure: false });
  const runRoutine = useAtomCommand(routineEnvironment.run, { reportFailure: false });
  const deleteRoutine = useAtomCommand(routineEnvironment.delete, { reportFailure: false });
  const assignSkill = useAtomCommand(routineEnvironment.assignSkill, { reportFailure: false });
  const [busyRoutineId, setBusyRoutineId] = useState<string | null>(null);

  const requireSuccess = <A, E>(result: AtomCommandResult<A, E>, fallback: string) => {
    if (hasTag(result, "Success")) return;

    const toast = routineFailureToast(result, t, fallback);

    toastManager.add({ type: "error", ...toast });

    throw new Error(fallback);
  };

  const withBusy = async (routineId: string, action: () => Promise<void>) => {
    setBusyRoutineId(routineId);

    try {
      await action();
    } finally {
      setBusyRoutineId(null);
    }
  };

  const startBusy = (routineId: string, action: () => Promise<void>) => {
    void withBusy(routineId, action).catch(() => undefined);
  };

  // A routine carries its own bot, which is the one whose skills it was built from.
  const skillAssignmentIds = async (botId: string, draft: RoutineAdapterDraft) => {
    if (!environmentId) throw new Error("The routine environment is unavailable.");

    const assignments = (snapshot?.skillAssignments ?? []).filter(
      (assignment) => assignment.botId === botId,
    );

    const provider = bots.find((candidate) => candidate.id === botId)?.engine?.provider;

    const providerSkills = providers
      .filter((entry) => entry.instanceId === provider)
      .flatMap((entry) => entry.skills)
      .filter((skill) => skill.enabled);

    const ids: SkillAssignmentId[] = [];

    for (const name of draft.skills) {
      const existing = assignments.find((assignment) => assignment.name === name);

      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const assignmentId = SkillAssignmentId.make(randomUUID());
      const metadata = providerSkills.find((skill) => skill.name === name);

      const result = await assignSkill({
        environmentId,
        input: {
          assignmentId,
          botId: BotId.make(botId),
          skillId: SkillId.make(name),
          name,
          description: metadata?.description ?? metadata?.shortDescription ?? null,
          createdAt: new Date().toISOString(),
        },
      });

      requireSuccess(result, t("Could not assign {name}", { name }));
      ids.push(assignmentId);
    }

    return ids;
  };

  const routineDefinition = async (botId: string, draft: RoutineAdapterDraft) => ({
    botId: BotId.make(botId),
    job: draft.name,
    procedure: draft.prompt,
    schedule: toRoutineSchedule(draft),
    timezone: draft.schedule.timezone,
    skillAssignmentIds: await skillAssignmentIds(botId, draft),
    connectorDependencies: draft.connectors.flatMap((name) => {
      const server = snapshot?.mcpServers?.find((candidate) => candidate.name === name);

      return server ? [McpServerId.make(server.id)] : [];
    }),
    projectId: ProjectId.make(draft.projectId),
    sandbox: draft.sandbox,
    approvalPolicy: draft.approval,
    delegateToBotId: draft.delegateToBotId === null ? null : BotId.make(draft.delegateToBotId),
  });

  const createRoutine =
    create === null
      ? null
      : async (draft: RoutineAdapterDraft) => {
          if (!environmentId) throw new Error("The routine environment is unavailable.");
          const routineId = RoutineId.make(randomUUID());

          await withBusy(routineId, async () => {
            const result = await draftRoutine({
              environmentId,
              input: {
                routineId,
                targetThreadId: create.threadId,
                ...(await routineDefinition(create.botId, draft)),
                createdAt: new Date().toISOString(),
              },
            });

            requireSuccess(result, t("Could not create routine"));
            toastManager.add({ type: "success", title: t("Routine draft created") });
          });
        };

  const actions: RoutineActions = {
    onUpdate: async (routineId, draft) => {
      if (!environmentId) throw new Error("The routine environment is unavailable.");
      const current = snapshot?.routines?.find((routine) => routine.id === routineId);

      if (!current) throw new Error("The routine no longer exists.");
      await withBusy(routineId, async () => {
        const result = await draftRoutine({
          environmentId,
          input: {
            routineId: RoutineId.make(routineId),
            targetThreadId: current.targetThreadId,
            ...(await routineDefinition(current.botId, draft)),
            expectedProcedureVersion: current.procedureVersion,
            createdAt: new Date().toISOString(),
          },
        });

        requireSuccess(result, t("Could not save routine"));
        toastManager.add({ type: "success", title: t("Routine draft saved") });
      });
    },
    onApproveProcedure: (routineId) => {
      const current = snapshot?.routines?.find((routine) => routine.id === routineId);

      if (!environmentId || !current) return;
      startBusy(routineId, async () => {
        const result = await approveRoutine({
          environmentId,
          input: {
            routineId: current.id,
            procedureVersion: current.procedureVersion,
            createdAt: new Date().toISOString(),
          },
        });

        requireSuccess(result, t("Could not approve procedure"));
      });
    },
    onDryRun: (routineId) => {
      if (!environmentId) return;
      startBusy(routineId, async () => {
        const result = await runRoutine({
          environmentId,
          input: {
            routineId: RoutineId.make(routineId),
            runId: RoutineRunId.make(randomUUID()),
            trigger: "dry-run",
            createdAt: new Date().toISOString(),
          },
        });

        requireSuccess(result, t("Could not start dry run"));
      });
    },
    onRunNow: (routineId) => {
      if (!environmentId) return;
      startBusy(routineId, async () => {
        const result = await runRoutine({
          environmentId,
          input: {
            routineId: RoutineId.make(routineId),
            runId: RoutineRunId.make(randomUUID()),
            trigger: "manual",
            createdAt: new Date().toISOString(),
          },
        });

        requireSuccess(result, t("Could not start routine"));
      });
    },
    onSetEnabled: (routineId, enabled) => {
      if (!environmentId) return;
      startBusy(routineId, async () => {
        const createdAt = new Date().toISOString();

        const result = enabled
          ? await enableRoutine({
              environmentId,
              input: { routineId: RoutineId.make(routineId), createdAt },
            })
          : await pauseRoutine({
              environmentId,
              input: {
                routineId: RoutineId.make(routineId),
                reason: "Paused by the user.",
                createdAt,
              },
            });

        requireSuccess(
          result,
          enabled ? t("Could not enable routine") : t("Could not pause routine"),
        );
      });
    },
    onSetPaused: (routineId, paused) => {
      if (!environmentId) return;
      startBusy(routineId, async () => {
        const createdAt = new Date().toISOString();

        const result = paused
          ? await pauseRoutine({
              environmentId,
              input: {
                routineId: RoutineId.make(routineId),
                reason: "Paused by the user.",
                createdAt,
              },
            })
          : await enableRoutine({
              environmentId,
              input: { routineId: RoutineId.make(routineId), createdAt },
            });

        requireSuccess(
          result,
          paused ? t("Could not pause routine") : t("Could not resume routine"),
        );
      });
    },
    onDelete: async (routineId) => {
      if (!environmentId) throw new Error("The routine environment is unavailable.");
      await withBusy(routineId, async () => {
        const result = await deleteRoutine({
          environmentId,
          input: {
            routineId: RoutineId.make(routineId),
            createdAt: new Date().toISOString(),
          },
        });

        requireSuccess(result, t("Could not delete routine"));
      });
    },
  };

  return { busyRoutineId, createRoutine, actions };
}
