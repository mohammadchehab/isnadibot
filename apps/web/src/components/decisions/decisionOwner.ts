import type { Decision } from "@isnadi/client-runtime/decisions";

import { useI18n } from "../../i18n";
import { useRosterStore } from "../roster/rosterStore";
import type { Bot } from "../roster/types";

export interface DecisionOwner {
  readonly name: string;
  readonly avatar: Bot["avatar"] | null;
}

/**
 * Resolves who a decision belongs to. A decision carries its owner as an id
 * only, so the roster store is the one place that knows the name and avatar.
 * A `null` avatar means the owner is a space, not a bot.
 */
export function useDecisionOwner(): (decision: Decision) => DecisionOwner {
  const { t } = useI18n();
  const bots = useRosterStore((state) => state.bots);
  const groups = useRosterStore((state) => state.groups);

  return (decision: Decision) => {
    if (decision.botId !== null) {
      const bot = bots.find((candidate) => candidate.id === decision.botId);

      return { name: bot?.name ?? t("Unknown bot"), avatar: bot?.avatar ?? null };
    }

    return {
      name: groups.find((group) => group.id === decision.groupId)?.name ?? "",
      avatar: null,
    };
  };
}
