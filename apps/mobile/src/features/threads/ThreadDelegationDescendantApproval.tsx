/**
 * The approval a nested delegation is parked on, shown on the card one level up.
 *
 * Its own card belongs to the feed of the chat that started it, and that chat is
 * never listed in the app, so this is the only surface left to answer it. The
 * caption names the bot that is asking, because the card's own header names the
 * chat in between instead.
 *
 * @module features/threads/ThreadDelegationDescendantApproval
 */
import { presentDelegation } from "@isnadi/client-runtime/delegation-presentation";
import type { EnvironmentId, IsnadiDelegationRecord, OrchestrationBot } from "@isnadi/contracts";
import { useMemo } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import { delegationChildThreadRef } from "./childThreadApproval";
import { PendingApprovalCard } from "./PendingApprovalCard";
import { useChildThreadApproval } from "./useChildThreadApproval";

/**
 * One component per nested record keeps the approval hook legal: a list of
 * records rendered by a single component could not call it per record.
 */
export function ThreadDelegationDescendantApproval(props: {
  readonly environmentId: EnvironmentId;
  readonly delegation: IsnadiDelegationRecord;
  readonly askerBot: OrchestrationBot | null;
}) {
  const { t } = useMobileI18n();
  const presentation = presentDelegation(props.delegation);

  const threadRef = useMemo(
    () => delegationChildThreadRef(props.environmentId, props.delegation),
    [props.environmentId, props.delegation],
  );

  const approval = useChildThreadApproval(threadRef);
  // Nothing is left to answer once the nested work has finished, so a stale row
  // never turns into a prompt the server would refuse.
  const pendingApproval = presentation.terminal ? null : approval.pendingApproval;

  if (pendingApproval === null) return null;

  const askerName = props.askerBot?.name ?? t("Unknown bot");

  return (
    <View className="mx-4 mb-3 gap-1" testID="delegation-descendant-approval">
      <Text className="text-xs text-foreground-muted">
        {t("{name} needs an answer", { name: askerName })}
      </Text>
      <PendingApprovalCard
        approval={pendingApproval}
        respondingApprovalId={approval.respondingApprovalId}
        onRespond={approval.respond}
      />
    </View>
  );
}
