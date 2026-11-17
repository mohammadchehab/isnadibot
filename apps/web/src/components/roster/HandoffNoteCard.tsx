import type { HandoffDoc } from "@isnadi/contracts";

import { useI18n } from "../../i18n";

/**
 * The note a bot leaves when it hands its context over, as the six rows the
 * handoff doc names. A field the bot left empty draws no row, because an empty
 * label says less than the row it would take up.
 */
export function HandoffNoteCard({ doc }: { readonly doc: HandoffDoc }) {
  const { t } = useI18n();

  const rows = [
    { label: t("Card"), value: doc.item },
    { label: t("Branch"), value: doc.branch },
    { label: t("Done"), value: doc.done },
    { label: t("Next"), value: doc.nextStep },
    { label: t("Waiting on"), value: doc.waitingOn },
    { label: t("Don’t"), value: doc.doNot },
  ].flatMap((row) => {
    const value = row.value?.trim() ?? "";

    return value.length > 0 ? [{ label: row.label, value }] : [];
  });

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-1.5 pb-2 ps-7.5 pe-2 text-xs"
      data-testid="handoff-note"
    >
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-3">
          <span className="w-27.5 shrink-0 font-mono text-muted-foreground">{row.label}</span>
          <span className="min-w-0 flex-1 whitespace-normal break-words text-foreground">
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
