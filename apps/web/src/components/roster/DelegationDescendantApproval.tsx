import { useMemo } from "react";
import type { IsnadiDelegationRecord } from "@isnadi/contracts";
import { presentDelegation } from "@isnadi/client-runtime/delegation-presentation";
import { scopeThreadRef } from "@isnadi/client-runtime/environment";

import { useI18n } from "../../i18n";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { BotApprovalPrompt } from "./BotApprovalPrompt";
import { useRosterStore } from "./rosterStore";
import { useRosterPendingApproval } from "./useRosterPendingApproval";

/**
 * The approval a nested delegation is parked on, shown on the card one level up.
 *
 * Its own card belongs to the feed of the chat that started it, and that chat is
 * not listed in the roster, so this is the only surface left to answer it. The
 * caption names the bot that is asking, because the card's own header names the
 * chat in between instead.
 */
export function DelegationDescendantApproval({
  delegation,
}: {
  readonly delegation: IsnadiDelegationRecord;
}) {
  const { t } = useI18n();
  const environmentId = usePrimaryEnvironmentId();
  const presentation = presentDelegation(delegation);
  const bots = useRosterStore((state) => state.bots);

  const threadRef = useMemo(
    () =>
      environmentId && presentation.childThreadId
        ? scopeThreadRef(environmentId, presentation.childThreadId)
        : null,
    [environmentId, presentation.childThreadId],
  );

  const approval = useRosterPendingApproval(threadRef);
  // Nothing is left to answer once the nested work has finished, so a stale row
  // never turns into a prompt the server would refuse.
  const pendingApproval = presentation.terminal ? null : approval.pendingApproval;

  if (pendingApproval === null) return null;

  const askerName = bots.find((bot) => bot.id === delegation.childBotId)?.name ?? t("Unknown bot");

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-muted-foreground">
        {t("{name} needs an answer", { name: askerName })}
      </p>
      <BotApprovalPrompt
        approval={pendingApproval}
        pendingCount={approval.pendingCount}
        responding={approval.responding}
        error={approval.responseError}
        onRespond={(decision) => approval.respond(pendingApproval.requestId, decision)}
      />
    </div>
  );
}
