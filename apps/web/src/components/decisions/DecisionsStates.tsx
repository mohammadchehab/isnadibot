import { useI18n } from "../../i18n";

const SKELETON_ROWS = [0, 1, 2, 3];

/**
 * What the page shows before any environment shell has answered. `useDecisions`
 * has no loading signal of its own, so without this the page would claim the
 * queue is empty for the first moment after launch or an environment switch.
 * The blocks stay still on purpose: a pulse repaints every frame and pegs the
 * GPU on a high-refresh display.
 */
export function DecisionsLoading() {
  const { t } = useI18n();

  return (
    <div
      aria-busy="true"
      aria-label={t("Loading decisions")}
      className="flex w-full flex-col overflow-clip rounded-xl border border-border bg-card"
      data-testid="decisions-loading"
      role="status"
    >
      {SKELETON_ROWS.map((row) => (
        <div
          key={row}
          className="flex h-13 items-center gap-3 border-b border-border px-3 last:border-b-0"
        >
          <span className="size-10 shrink-0 rounded-full bg-muted" />
          <span className="flex min-w-0 flex-1 flex-col gap-2">
            <span className="h-3 w-35 max-w-full rounded-sm bg-muted" />
            <span className="h-2.5 w-80 max-w-full rounded-sm bg-muted" />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The queue with nothing in it. It keeps the shipped headline and adds the one
 * line that says what the page is for.
 */
export function DecisionsEmpty() {
  const { t } = useI18n();

  return (
    <div
      className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-border bg-card px-6 py-10 text-center"
      data-testid="decisions-empty"
    >
      <p className="text-sm font-semibold leading-5 text-foreground">
        {t("Nothing waiting on you")}
      </p>
      <p className="text-xs leading-18px text-muted-foreground">
        {t("When a bot needs an approval or an answer, it shows up here.")}
      </p>
    </div>
  );
}
