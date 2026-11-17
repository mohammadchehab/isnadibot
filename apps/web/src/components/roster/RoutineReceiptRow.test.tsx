import { BotId } from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { RoutineReceiptRow } from "./RoutineReceiptRow";
import type { RoutineReceipt } from "./routineReceipts";

const BOT = BotId.make("bot-tailor");

const applied = (undoBotId: BotId | null): RoutineReceipt => ({
  id: "activity-applied",
  createdAt: "2026-11-17T09:40:00.000Z",
  text: "You asked Tailor to hand off. It wrote a note and started a new context from it.",
  tone: "info",
  handoff: { icon: "refresh", undoBotId },
});

const notApplied: RoutineReceipt = {
  id: "activity-not-applied",
  createdAt: "2026-11-17T09:40:00.000Z",
  text: "Hand off was interrupted, so nothing reset. The note stays in the chat.",
  tone: "info",
  handoff: { icon: "alert", undoBotId: null },
};

const routine: RoutineReceipt = {
  id: "activity-routine",
  createdAt: "2026-11-17T09:40:00.000Z",
  text: "Morning triage finished.",
  tone: "success",
};

describe("RoutineReceiptRow", () => {
  // Undo is the reset's only reverse, so it is there for exactly as long as the
  // window the derivation keeps open.
  it("offers Undo and Hide on a reset the bot has not written past", () => {
    const markup = renderToStaticMarkup(
      <RoutineReceiptRow receipt={applied(BOT)} onUndoHandoff={() => {}} onHide={() => {}} />,
    );

    expect(markup).toContain(">Undo<");
    expect(markup).toContain(">Hide<");
  });

  it("keeps Hide and drops Undo once the window has closed", () => {
    const markup = renderToStaticMarkup(
      <RoutineReceiptRow receipt={applied(null)} onUndoHandoff={() => {}} onHide={() => {}} />,
    );

    expect(markup).toContain(">Hide<");
    expect(markup).not.toContain(">Undo<");
  });

  // A handoff's own buttons live inside the row, so the row itself must not be
  // one: nesting them in a button would swallow their clicks.
  it("does not offer to open Routines from a handoff row", () => {
    const markup = renderToStaticMarkup(
      <RoutineReceiptRow receipt={applied(BOT)} onOpenRoutines={() => {}} onHide={() => {}} />,
    );

    expect(markup).not.toContain("Open Routines");
    expect(markup).not.toContain("aria-label");
  });

  it("draws the interrupted glyph rather than the routine clock", () => {
    const markup = renderToStaticMarkup(
      <RoutineReceiptRow receipt={notApplied} onHide={() => {}} />,
    );

    expect(markup).toContain("lucide-circle-alert");
    expect(markup).not.toContain("lucide-clock-3");
  });

  it("leaves a routine receipt opening Routines as it did before", () => {
    const markup = renderToStaticMarkup(
      <RoutineReceiptRow receipt={routine} onOpenRoutines={() => {}} onHide={() => {}} />,
    );

    expect(markup).toContain("Open Routines");
    expect(markup).not.toContain(">Hide<");
  });
});
