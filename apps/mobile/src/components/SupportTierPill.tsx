import { supportTierOf, type SupportTier, type SupportTierKind } from "@isnadi/contracts";

import { StatusPill, type StatusTone } from "./StatusPill";

const TIER_TONE: Readonly<Record<SupportTier, StatusTone>> = {
  supported: {
    label: "Supported",
    pillClassName: "bg-emerald-500/12 dark:bg-emerald-500/16",
    textClassName: "text-emerald-700 dark:text-emerald-300",
  },
  experimental: {
    label: "Experimental",
    pillClassName: "bg-neutral-500/10 dark:bg-neutral-500/16",
    textClassName: "text-neutral-600 dark:text-neutral-300",
  },
};

/** The phone's small tier pill, reading the same config the web badge does. */
export function SupportTierPill({ tier }: { readonly tier: SupportTier }) {
  return <StatusPill {...TIER_TONE[tier]} size="compact" />;
}

/** The same pill for an entry named by its kind and id. */
export function SupportTierPillFor({
  kind,
  id,
}: {
  readonly kind: SupportTierKind;
  readonly id: string;
}) {
  return <SupportTierPill tier={supportTierOf(kind, id)} />;
}
