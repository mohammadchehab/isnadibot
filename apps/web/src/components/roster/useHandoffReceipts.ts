import {
  commandFailureMessage,
  isAtomCommandInterrupted,
} from "@isnadi/client-runtime/state/runtime";
import type { BotId, OrchestrationThreadActivity, ScopedThreadRef } from "@isnadi/contracts";
import { useCallback, useMemo, useState } from "react";

import { hasTag } from "~/lib/taggedUnion";

import { useI18n } from "../../i18n";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { toastManager } from "../ui/toast";
import type { BotConversationEntry } from "./botConversationPresentation";
import { deriveHandoffReceipts } from "./handoffReceipts";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The handoff's own record in a chat: the note, and what became of the reset.
 *
 * Hiding is the reader's business for this session only — the activity is still
 * there, so a reload brings the row back rather than pretending the handoff never
 * happened. Undo is the reset's one reverse, and the server refuses it once the
 * bot has moved on; a success hides the row, because its sentence would otherwise
 * claim a reset that no longer stands.
 */
export function useHandoffReceipts(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly entries: ReadonlyArray<BotConversationEntry>;
  readonly botName: (botId: string) => string | null;
}) {
  const { activities, botName, entries, threadRef } = input;
  const { t } = useI18n();
  const threadId = threadRef?.threadId ?? null;

  const undoContextReset = useAtomCommand(threadEnvironment.undoContextReset, {
    reportFailure: false,
  });

  const [hidden, setHidden] = useState<{
    threadId: string | null;
    ids: ReadonlySet<string>;
  }>({ threadId: null, ids: EMPTY });

  const hiddenIds = hidden.threadId === threadId ? hidden.ids : EMPTY;

  const hide = useCallback(
    (id: string) => {
      setHidden((previous) => {
        const ids = previous.threadId === threadId ? previous.ids : EMPTY;

        return { threadId, ids: new Set(ids).add(id) };
      });
    },
    [threadId],
  );

  const items = useMemo(
    () =>
      deriveHandoffReceipts(
        {
          activities,
          messages: entries.map((entry) => entry.message),
          botName,
        },
        { t },
      ).filter((item) => !hiddenIds.has(item.id)),
    [activities, entries, botName, hiddenIds, t],
  );

  const undo = useCallback(
    async (id: string, botId: BotId) => {
      if (!threadRef) return;

      const result = await undoContextReset({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, botId },
      });

      if (hasTag(result, "Success")) {
        hide(id);

        return;
      }

      if (isAtomCommandInterrupted(result)) return;

      toastManager.add({
        type: "error",
        title: t("Could not undo the hand off"),
        description: commandFailureMessage(result, {
          t,
          fallback: "An unexpected error occurred.",
        }),
      });
    },
    [hide, t, threadRef, undoContextReset],
  );

  return { items, hide, undo };
}
