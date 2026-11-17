import { Match } from "effect";
import type { BotId } from "@isnadi/contracts";
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  Clock3Icon,
  RefreshCwIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";

import { useI18n } from "../../i18n";
import { routineReceiptLabelText, type RoutineReceipt } from "./routineReceipts";

/**
 * A routine run note in a bot chat. Opens Routines when the routine still
 * exists. A handoff row draws its own glyph and offers the two things a reader
 * wants from it: undoing the reset while that is still possible, and hiding the
 * row once it has been read.
 */
export function RoutineReceiptRow({
  receipt,
  onOpenRoutines,
  onUndoHandoff,
  onHide,
}: {
  readonly receipt: RoutineReceipt;
  readonly onOpenRoutines?: () => void;
  readonly onUndoHandoff?: (botId: BotId) => void;
  readonly onHide?: () => void;
}) {
  const { t, formatDate } = useI18n();

  const handoff = receipt.handoff;
  const undoBotId = handoff?.undoBotId ?? null;

  const Icon = handoff
    ? handoff.icon === "refresh"
      ? RefreshCwIcon
      : CircleAlertIcon
    : Match.value(receipt).pipe(
        Match.when({ tone: "error" }, () => CircleAlertIcon),
        Match.when({ tone: "success" }, () => CircleCheckIcon),
        Match.orElse(() => Clock3Icon),
      );

  const error = receipt.tone === "error";
  // A handoff row's own controls are the buttons inside it, so the row is not one.
  const opensRoutines = !handoff && !receipt.archived && !!onOpenRoutines;
  const Row = opensRoutines ? "button" : "div";

  return (
    <Row
      {...(opensRoutines
        ? {
            type: "button" as const,
            "aria-label": t("{text}. Open Routines", {
              text: routineReceiptLabelText(receipt.text),
            }),
          }
        : {})}
      className={cn(
        "mx-auto flex w-full max-w-3xl items-start gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground",
        opensRoutines &&
          "outline-none transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        error && "bg-destructive/8 text-destructive-foreground",
        error && opensRoutines && "hover:bg-destructive/12 hover:text-destructive-foreground",
      )}
      data-testid="routine-receipt"
      onClick={opensRoutines ? onOpenRoutines : undefined}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-normal break-words text-start leading-5">
        {receipt.text}
      </span>
      {undoBotId !== null && onUndoHandoff ? (
        <button
          type="button"
          className="shrink-0 text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onUndoHandoff(undoBotId)}
        >
          {t("Undo")}
        </button>
      ) : null}
      {handoff && onHide ? (
        <button
          type="button"
          className="shrink-0 text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onHide}
        >
          {t("Hide")}
        </button>
      ) : null}
      <time className="shrink-0 text-11px text-muted-foreground/60" dateTime={receipt.createdAt}>
        {formatDate(new Date(receipt.createdAt), { hour: "numeric", minute: "2-digit" })}
      </time>
      {opensRoutines ? (
        <ChevronRightIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 opacity-60 rtl:-scale-x-100"
        />
      ) : null}
    </Row>
  );
}
