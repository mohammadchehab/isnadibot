import { Predicate } from "effect";
import type { EnvironmentId, ScopedThreadRef, ThreadId, TurnId } from "@isnadi/contracts";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { useThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  type BotControllableShell,
  type BotControlTarget,
  buildBotClearInput,
  buildBotInterruptInput,
  collectClearableSessions,
  collectRunningTurns,
} from "./botControls.logic";
import { commandFailureMessage } from "./rosterCommands.logic";

interface InterruptRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}

/**
 * The two commands behind every bot control, as plain calls. Rows, the fleet
 * menu and the command palette all go through here so a control means the same
 * thing wherever it is reached from.
 */
export function useBotControlCommands() {
  const { t } = useI18n();
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, { reportFailure: false });
  const stopSession = useAtomCommand(threadEnvironment.stopSession, { reportFailure: false });

  const interruptThread = useCallback(
    async ({ environmentId, threadId, turnId }: InterruptRequest): Promise<boolean> => {
      const result = await interruptTurn({
        environmentId,
        // The turn id pins the interrupt to the turn the user saw; without it
        // the server ends whichever turn is running when the command lands.
        input: turnId === undefined ? { threadId } : { threadId, turnId },
      });

      if (Predicate.isTagged(result, "Failure")) {
        toastManager.add({
          type: "error",
          title: t("Could not interrupt the bot"),
          description: commandFailureMessage(result, t),
        });

        return false;
      }

      return true;
    },
    [interruptTurn, t],
  );

  const clearThread = useCallback(
    async (environmentId: EnvironmentId, threadId: ThreadId): Promise<boolean> => {
      const result = await stopSession({ environmentId, input: { threadId } });

      if (Predicate.isTagged(result, "Failure")) {
        toastManager.add({
          type: "error",
          title: t("Could not clear the bot's context"),
          description: commandFailureMessage(result, t),
        });

        return false;
      }

      return true;
    },
    [stopSession, t],
  );

  /** Ends the turn a bot's own chat is running, if one is. */
  const interruptBot = useCallback(
    async (ref: ScopedThreadRef, shell: BotControllableShell | null): Promise<boolean> => {
      const input = buildBotInterruptInput(shell);

      if (input === null) return false;

      return interruptThread({
        environmentId: ref.environmentId,
        threadId: input.threadId,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
      });
    },
    [interruptThread],
  );

  /** Stops a bot's live provider session, so its next message starts fresh. */
  const clearBot = useCallback(
    async (ref: ScopedThreadRef, shell: BotControllableShell | null): Promise<boolean> => {
      const input = buildBotClearInput(shell);

      if (input === null) return false;

      return clearThread(ref.environmentId, input.threadId);
    },
    [clearThread],
  );

  return { interruptThread, clearThread, interruptBot, clearBot };
}

/**
 * Fleet-wide controls, across every environment this client has loaded. Both
 * the palette's Bots group and any future header menu read them, so they take
 * the shells the client already has rather than one environment's snapshot.
 */
export function useBotFleetControls() {
  const { t } = useI18n();
  const shells = useThreadShells();
  const { interruptThread, clearThread } = useBotControlCommands();

  const running: readonly BotControlTarget[] = collectRunningTurns(shells);
  const clearable: readonly BotControlTarget[] = collectClearableSessions(shells);

  const report = useCallback(
    (outcomes: readonly boolean[], doneMessage: string, partialMessage: string) => {
      const done = outcomes.filter(Boolean).length;

      if (done === outcomes.length) {
        toastManager.add({ type: "success", title: doneMessage });

        return true;
      }

      toastManager.add({ type: "error", title: partialMessage });

      return false;
    },
    [],
  );

  const interruptAll = useCallback(async (): Promise<boolean> => {
    if (running.length === 0) return false;

    const outcomes = await Promise.all(
      running.map((target) =>
        interruptThread({
          environmentId: target.environmentId,
          threadId: target.threadId,
          ...(target.turnId === null ? {} : { turnId: target.turnId }),
        }),
      ),
    );

    return report(
      outcomes,
      t("Interrupted {count} bots", { count: running.length }),
      t("Interrupted {done} of {count} bots", {
        done: outcomes.filter(Boolean).length,
        count: running.length,
      }),
    );
  }, [interruptThread, report, running, t]);

  const clearAll = useCallback(async (): Promise<boolean> => {
    if (clearable.length === 0) return false;

    const outcomes = await Promise.all(
      clearable.map((target) => clearThread(target.environmentId, target.threadId)),
    );

    return report(
      outcomes,
      t("Cleared {count} bot contexts", { count: clearable.length }),
      t("Cleared {done} of {count} bot contexts", {
        done: outcomes.filter(Boolean).length,
        count: clearable.length,
      }),
    );
  }, [clearable, clearThread, report, t]);

  return {
    running,
    clearable,
    interruptAll,
    clearAll,
    canInterruptAll: running.length > 0,
    canClearAll: clearable.length > 0,
  };
}
