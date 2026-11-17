import { createTranslator } from "@isnadi/client-runtime/i18n";
import {
  HANDOFF_ACTIVITY_KIND,
  HANDOFF_APPLIED_ACTIVITY_KIND,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  HandoffActivityPayload,
  HandoffAppliedActivityPayload,
  HandoffNotAppliedActivityPayload,
  type BotId,
  type HandoffDoc,
  type OrchestrationThreadActivity,
} from "@isnadi/contracts";
import { Schema } from "effect";

import type { RoutineReceipt } from "./routineReceipts";

const isNotePayload = Schema.is(HandoffActivityPayload);

const isAppliedPayload = Schema.is(HandoffAppliedActivityPayload);

const isNotAppliedPayload = Schema.is(HandoffNotAppliedActivityPayload);

type ReceiptTranslator = Pick<ReturnType<typeof createTranslator>, "t">;

const englishTranslator: ReceiptTranslator = createTranslator("en");

/** The note a bot left when it handed off: the chat draws it as a card, not a row. */
export interface HandoffNote {
  readonly id: string;
  readonly createdAt: string;
  readonly doc: HandoffDoc;
}

/** What a handoff puts in the chat: the note itself, and the rows that say what became of it. */
export type HandoffTimelineItem = RoutineReceipt | HandoffNote;

export function isHandoffNote(item: HandoffTimelineItem): item is HandoffNote {
  return "doc" in item;
}

/** A reply in the chat, as far as the undo window is concerned. */
export interface HandoffChatReply {
  readonly respondingBotId?: BotId | null | undefined;
  readonly createdAt: string;
}

/**
 * What became of a requested handoff, as rows in the chat.
 *
 * The server appends these as thread activities; the sentence around the data is
 * written here so the row reads in the user's language and the bot's name stays
 * exactly as written. A payload this client cannot read falls back to the
 * server's own summary rather than dropping the row, and a bot the roster no
 * longer knows falls back to that summary too, because a sentence needs a name.
 *
 * `no-note` and `turn-not-completed` are different accidents — the turn ended
 * without a note, or the note's turn was cut short — and the chat says which one
 * happened. Both leave the context where it was, so neither offers Undo. A reset
 * that did land keeps Undo until that bot's next turn starts, which the chat can
 * see for itself in the replies it already has.
 */
export function deriveHandoffReceipts(
  input: {
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
    readonly messages: ReadonlyArray<HandoffChatReply>;
    readonly botName: (botId: string) => string | null;
  },
  { t }: ReceiptTranslator = englishTranslator,
): HandoffTimelineItem[] {
  const startedNextTurn = (botId: string, after: string) =>
    input.messages.some(
      (message) => message.respondingBotId === botId && message.createdAt > after,
    );

  const summaryRow = (
    activity: OrchestrationThreadActivity,
    icon: "refresh" | "alert",
  ): RoutineReceipt => ({
    id: activity.id,
    createdAt: activity.createdAt,
    text: activity.summary,
    tone: "info",
    handoff: { icon, undoBotId: null },
  });

  const items: HandoffTimelineItem[] = [];

  for (const activity of input.activities) {
    if (activity.kind === HANDOFF_ACTIVITY_KIND) {
      if (isNotePayload(activity.payload)) {
        items.push({
          id: activity.id,
          createdAt: activity.createdAt,
          doc: activity.payload.doc,
        });
      }

      continue;
    }

    if (activity.kind === HANDOFF_APPLIED_ACTIVITY_KIND) {
      const botName = isAppliedPayload(activity.payload)
        ? input.botName(activity.payload.botId)
        : null;

      if (!isAppliedPayload(activity.payload) || botName === null) {
        items.push(summaryRow(activity, "refresh"));

        continue;
      }

      const undoOpen = !startedNextTurn(activity.payload.botId, activity.createdAt);

      items.push({
        id: activity.id,
        createdAt: activity.createdAt,
        text: undoOpen
          ? t("You asked {bot} to hand off. It wrote a note and started a new context from it.", {
              bot: botName,
            })
          : t("{bot} started its next turn, so Undo is closed. The note stays in the chat.", {
              bot: botName,
            }),
        tone: "info",
        handoff: {
          icon: "refresh",
          undoBotId: undoOpen ? activity.payload.botId : null,
        },
      });

      continue;
    }

    if (activity.kind === HANDOFF_NOT_APPLIED_ACTIVITY_KIND) {
      const botName = isNotAppliedPayload(activity.payload)
        ? input.botName(activity.payload.botId)
        : null;

      if (!isNotAppliedPayload(activity.payload) || botName === null) {
        items.push(summaryRow(activity, "alert"));

        continue;
      }

      items.push({
        id: activity.id,
        createdAt: activity.createdAt,
        text:
          activity.payload.reason === "no-note"
            ? t(
                "Hand off did not happen. {bot}’s turn ended without writing a note, so its context is unchanged.",
                { bot: botName },
              )
            : t("Hand off was interrupted, so nothing reset. The note stays in the chat."),
        tone: "info",
        handoff: { icon: "alert", undoBotId: null },
      });
    }
  }

  return items.toSorted(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}
