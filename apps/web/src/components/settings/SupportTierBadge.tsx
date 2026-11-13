import { supportTierOf, type SupportTier, type SupportTierKind } from "@isnadi/contracts";

import { Badge } from "../ui/badge";

const TIER_LABEL: Readonly<Record<SupportTier, string>> = {
  supported: "Supported",
  experimental: "Experimental",
};

const TIER_DESCRIPTION: Readonly<Record<SupportTier, string>> = {
  supported: "We stand behind this: it is tested and supported up front.",
  experimental: "Experimental: it works, but it can change or break between releases.",
};

/** The one badge a surface shows for an entry's support tier. */
export function SupportTierBadge({ tier }: { readonly tier: SupportTier }) {
  return (
    <Badge
      variant={tier === "supported" ? "success" : "quiet"}
      size="sm"
      title={TIER_DESCRIPTION[tier]}
    >
      {TIER_LABEL[tier]}
    </Badge>
  );
}

/** The same badge for an entry named by its kind and id, tiered by the shared config. */
export function SupportTierBadgeFor({
  kind,
  id,
}: {
  readonly kind: SupportTierKind;
  readonly id: string;
}) {
  return <SupportTierBadge tier={supportTierOf(kind, id)} />;
}
