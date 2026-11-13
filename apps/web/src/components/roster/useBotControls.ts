import { Predicate } from "effect";
import type { BotId, EnvironmentId, ScopedThreadRef, ThreadId, TurnId } from "@isnadi/contracts";
import { useCallback } from "react";

import { useI18n } from "../../i18n";
import { useThreadShells } from "../../state/entities";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { useOpenChat } from "../chat/useOpenChat";
import { toastManager } from "../ui/toast";
import {
  type BotControllableShell,
  type BotControlTarget,
  buildBotClearInput,
  buildBotInterruptInput,
  buildBotSteerInput,
  collectClearableSessions,
  collectRunningTurns,
} from "./botControls.logic";
import { requestComposerFocus } from "./composerFocus";
import { commandFailureMessage } from "./rosterCommands.logic";

interface InterruptRequest {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly turnId?: TurnId;
}

/**
 * Steer: open the bot's chat and ask its composer to take the caret, so the
 * user's next keystrokes land as a correction to the turn that is running. The
 * request is made before navigating, so a composer that mounts with the chat
 * finds it waiting.
 */
function useSteerCommand() {
  const openChat = useOpenChat();

  return useCallback(
    async (target: {
      readonly environmentId: EnvironmentId;
      readonly threadId: ThreadId;
      readonly botId: BotId | null;
    }): Promise<boolean> => {
      if (target.botId === null) return false;

      requestComposerFocus(target.botId);
      await openChat({ environmentId: target.environmentId, threadId: target.threadId });

      return true;
    },
    [openChat],
  );
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
  const steer = useSteerCommand();

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

  /** Opens a bot's chat on a running turn and puts the caret in its composer. */
  const steerBot = useCallback(
    async (ref: ScopedThreadRef, shell: BotControllableShell | null): Promise<boolean> => {
      const input = buildBotSteerInput(shell);

      if (input === null) return false;

      return steer({
        environmentId: ref.environmentId,
        threadId: input.threadId,
        botId: input.botId,
      });
    },
    [steer],
  );

  return { interruptThread, clearThread, interruptBot, clearBot, steerBot };
}

/**
 * Fleet-wide controls, across every environment this client has loaded. Both
 * the palette's Bots group and any future header menu read them, so they take
 * the shells the client already has rather than one environment's snapshot.
 */
export function useBotFleetControls() {
  const { plural } = useI18n();
  const shells = useThreadShells();
  const { interruptThread, clearThread } = useBotControlCommands();
  const steer = useSteerCommand();

  const running: readonly BotControlTarget[] = collectRunningTurns(shells);
  const clearable: readonly BotControlTarget[] = collectClearableSessions(shells);

  // A group chat's composer is keyed by the group, so only bot chats can be steered.
  const steerable: readonly BotControlTarget[] = running.filter((target) => target.botId !== null);

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
      plural(running.length, {
        one: "Interrupted {count} bot",
        other: "Interrupted {count} bots",
      }),
      plural(
        running.length,
        {
          one: "Interrupted {done} of {count} bot",
          other: "Interrupted {done} of {count} bots",
        },
        { done: outcomes.filter(Boolean).length },
      ),
    );
  }, [interruptThread, plural, report, running]);

  const clearAll = useCallback(async (): Promise<boolean> => {
    if (clearable.length === 0) return false;

    const outcomes = await Promise.all(
      clearable.map((target) => clearThread(target.environmentId, target.threadId)),
    );

    return report(
      outcomes,
      plural(clearable.length, {
        one: "Cleared {count} bot context",
        other: "Cleared {count} bot contexts",
      }),
      plural(
        clearable.length,
        {
          one: "Cleared {done} of {count} bot context",
          other: "Cleared {done} of {count} bot contexts",
        },
        { done: outcomes.filter(Boolean).length },
      ),
    );
  }, [clearable, clearThread, plural, report]);

  return {
    running,
    clearable,
    steerable,
    interruptAll,
    clearAll,
    steer,
    canInterruptAll: running.length > 0,
    canClearAll: clearable.length > 0,
    canSteer: steerable.length > 0,
  };
}
