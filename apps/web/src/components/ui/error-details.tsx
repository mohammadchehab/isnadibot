import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "~/i18n";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./collapsible";

/**
 * The text to put behind a disclosure for anything thrown or squashed. Non-`Error` causes still
 * carry information (a decoded failure tag, a string from the environment), so they are shown
 * rather than flattened into a generic sentence.
 */
export function rawErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The raw text a provider or the environment reported, kept verbatim so a user can act on it
 * and support can follow the trace. Never rendered inline: it is not in the interface language,
 * so it belongs behind a disclosure the user opens on purpose.
 */
export function RawErrorDetails({
  message,
  className,
}: {
  readonly message: string;
  readonly className?: string;
}) {
  return (
    <pre
      className={cn(
        "max-h-52 overflow-auto rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre-wrap select-text text-muted-foreground",
        className,
      )}
      data-slot="raw-error-details"
    >
      {message}
    </pre>
  );
}

/**
 * A "Show details" disclosure for a raw error message on a surface that is not a toast. Toasts
 * get the same affordance from `ToastData.expandableContent`, so only non-toast surfaces need
 * this. Both read the same catalogue labels, so the wording stays in one place.
 */
export function ErrorDetailsDisclosure({
  message,
  className,
}: {
  readonly message: string;
  readonly className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible className={cn("min-w-0", className)} onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className="inline-flex cursor-pointer items-center gap-1 rounded-md py-0.5 text-start text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        data-slot="error-details-trigger"
      >
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform rtl:-scale-x-100 data-panel-open:rotate-90"
        />
        <span>{open ? t("Hide details") : t("Show details")}</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <RawErrorDetails className="mt-1" message={message} />
      </CollapsiblePanel>
    </Collapsible>
  );
}
