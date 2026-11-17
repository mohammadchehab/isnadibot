import {
  BotId,
  EventId,
  HANDOFF_ACTIVITY_KIND,
  HANDOFF_APPLIED_ACTIVITY_KIND,
  HANDOFF_NOT_APPLIED_ACTIVITY_KIND,
  TurnId,
  type OrchestrationThreadActivity,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveHandoffReceipts, isHandoffNote, type HandoffChatReply } from "./handoffReceipts";

const BOT = BotId.make("bot-tailor");

const TURN = TurnId.make("turn-1");

const activity = (
  kind: string,
  payload: OrchestrationThreadActivity["payload"],
  createdAt = "2026-11-17T09:40:00.000Z",
): OrchestrationThreadActivity => ({
  id: EventId.make(`activity-${kind}-${createdAt}`),
  tone: "info",
  kind,
  summary: "the server's own sentence",
  payload,
  turnId: null,
  createdAt,
});

const note = activity(HANDOFF_ACTIVITY_KIND, {
  botId: BOT,
  doc: {
    item: "Outreach to C-104",
    branch: "tailor/outreach-c-104",
    done: "First draft written",
    nextStep: "Shorten to 120 words",
  },
});

const applied = activity(HANDOFF_APPLIED_ACTIVITY_KIND, {
  botId: BOT,
  turnId: TURN,
  handoffActivityId: note.id,
});

const notApplied = (reason: "no-note" | "turn-not-completed" | "reset-refused") =>
  activity(HANDOFF_NOT_APPLIED_ACTIVITY_KIND, { botId: BOT, turnId: TURN, reason });

const reply = (respondingBotId: BotId | null, createdAt: string): HandoffChatReply => ({
  respondingBotId,
  createdAt,
});

const derive = (
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  messages: ReadonlyArray<HandoffChatReply> = [],
) =>
  deriveHandoffReceipts({
    activities,
    messages,
    botName: (botId) => (botId === BOT ? "Tailor" : null),
  });

describe("deriveHandoffReceipts", () => {
  it("draws the note as a card, not a row", () => {
    const [item] = derive([note]);

    expect(item && isHandoffNote(item)).toBe(true);
    expect(item && isHandoffNote(item) ? item.doc.item : null).toBe("Outreach to C-104");
  });

  // The reset's only reverse is Undo, and it is live until the bot moves on.
  it("offers Undo on a reset the bot has not written past", () => {
    const [item] = derive([applied], [reply(BOT, "2026-11-17T09:35:00.000Z")]);

    expect(item).toMatchObject({
      text: "You asked Tailor to hand off. It wrote a note and started a new context from it.",
      tone: "info",
      handoff: { icon: "refresh", undoBotId: BOT },
    });
  });

  it("closes Undo once that bot's next turn is in the chat", () => {
    const [item] = derive([applied], [reply(BOT, "2026-11-17T10:05:00.000Z")]);

    expect(item).toMatchObject({
      text: "Tailor started its next turn, so Undo is closed. The note stays in the chat.",
      handoff: { icon: "refresh", undoBotId: null },
    });
  });

  // Another bot answering in a group chat does not close this bot's window.
  it("keeps Undo open for a reply by someone else", () => {
    const [item] = derive(
      [applied],
      [reply(BotId.make("bot-tracker"), "2026-11-17T10:05:00.000Z")],
    );

    expect(item).toMatchObject({ handoff: { undoBotId: BOT } });
  });

  it("says a turn ended without a note, and that nothing changed", () => {
    const [item] = derive([notApplied("no-note")]);

    expect(item).toMatchObject({
      text: "Hand off did not happen. Tailor’s turn ended without writing a note, so its context is unchanged.",
      tone: "info",
      handoff: { icon: "alert", undoBotId: null },
    });
  });

  // A note whose turn was cut short and a cut the chat could no longer take are
  // both an interrupted hand off, and both leave the note in the chat.
  it.each(["turn-not-completed", "reset-refused"] as const)(
    "says an interrupted hand off reset nothing: %s",
    (reason) => {
      const [item] = derive([notApplied(reason)]);

      expect(item).toMatchObject({
        text: "Hand off was interrupted, so nothing reset. The note stays in the chat.",
        handoff: { icon: "alert", undoBotId: null },
      });
    },
  );

  // A sentence needs a name; without one the server's own summary still says what happened.
  it("falls back to the server's summary for a bot the roster does not know", () => {
    const [item] = derive([
      activity(HANDOFF_APPLIED_ACTIVITY_KIND, {
        botId: BotId.make("bot-gone"),
        turnId: TURN,
        handoffActivityId: note.id,
      }),
    ]);

    expect(item).toMatchObject({
      text: "the server's own sentence",
      handoff: { icon: "refresh", undoBotId: null },
    });
  });

  it("falls back to the server's summary for a payload it cannot read", () => {
    const [item] = derive([activity(HANDOFF_NOT_APPLIED_ACTIVITY_KIND, { botId: BOT })]);

    expect(item).toMatchObject({ text: "the server's own sentence", handoff: { icon: "alert" } });
  });

  it("orders the note before the row that reports it", () => {
    const items = derive([applied, note]);

    expect(items.map((item) => (isHandoffNote(item) ? "note" : "row"))).toEqual(["note", "row"]);
  });

  it("leaves activities that are not handoffs alone", () => {
    expect(derive([activity("thread.created", {})])).toEqual([]);
  });
});
