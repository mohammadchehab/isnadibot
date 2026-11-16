import { Predicate } from "effect";
import { Match } from "effect";
/**
 * The feed's delegation card wired to the environment: Let it finish and Cancel
 * send the same cancel command the web card sends (keep true or false), and Try
 * again sends `delegation.retry`. A refused command shows the server's reason.
 *
 * @module features/threads/ThreadDelegationFeedCard
 */
import { useAtomValue } from "@effect/atom-react";
import type { IsnadiDelegationRecord, EnvironmentId, OrchestrationBot } from "@isnadi/contracts";
import {
  descendantDelegations,
  presentDelegation,
  type DelegationAction,
} from "@isnadi/client-runtime/delegation-presentation";
import { squashAtomCommandFailure } from "@isnadi/client-runtime/state/runtime";
import { useCallback, useMemo } from "react";
import { Alert, View } from "react-native";

import { useMobileI18n } from "../../lib/i18n";
import { environmentDelegationsAtom } from "../../state/delegations";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { delegationChildThreadRef } from "./childThreadApproval";
import { ThreadDelegationCard } from "./ThreadDelegationCard";
import { ThreadDelegationDescendantApproval } from "./ThreadDelegationDescendantApproval";
import { useChildThreadApproval } from "./useChildThreadApproval";

export function ThreadDelegationFeedCard(props: {
  readonly environmentId: EnvironmentId;
  readonly delegation: IsnadiDelegationRecord;
  readonly actions: ReadonlyArray<DelegationAction>;
  readonly childBot: OrchestrationBot | null;
  readonly parentBot: OrchestrationBot | null;
  /** Bots by id, so a nested approval can name the bot that is asking. */
  readonly botsById?: ReadonlyMap<string, OrchestrationBot>;
}) {
  const { t } = useMobileI18n();
  const { environmentId } = props;
  const { delegationId } = props.delegation;

  // The delegated chat is not listed anywhere in the app, so its approval is
  // answered here or nowhere.
  const childThreadRef = useMemo(
    () => delegationChildThreadRef(environmentId, props.delegation),
    [environmentId, props.delegation],
  );

  const childApproval = useChildThreadApproval(childThreadRef);

  // The chat this card's delegation started can start its own delegations. They
  // are two levels down, so only this card can answer their approvals.
  const environmentDelegations = useAtomValue(environmentDelegationsAtom(environmentId));

  const descendants = useMemo(() => {
    const childThreadId = presentDelegation(props.delegation).childThreadId;

    return childThreadId === null
      ? []
      : descendantDelegations(environmentDelegations, childThreadId);
  }, [environmentDelegations, props.delegation]);

  const cancelDelegation = useAtomCommand(orchestrationEnvironment.cancelDelegation, {
    reportFailure: false,
  });

  const retryDelegation = useAtomCommand(orchestrationEnvironment.retryDelegation, {
    reportFailure: false,
  });

  const onAction = useCallback(
    async (action: DelegationAction) => {
      const result =
        action === "retry"
          ? await retryDelegation({ environmentId, input: { delegationId } })
          : await cancelDelegation({
              environmentId,
              input: { delegationId, keep: action === "keep" },
            });

      if (!Predicate.isTagged(result, "Failure")) return;
      const error = squashAtomCommandFailure(result);

      const title = Match.value(action).pipe(
        Match.when("keep", () => t("Could not let the work finish")),
        Match.when("cancel", () => t("Could not cancel delegation")),
        Match.orElse(() => t("Could not retry the work")),
      );

      Alert.alert(title, error instanceof Error ? error.message : undefined);
    },
    [cancelDelegation, delegationId, environmentId, retryDelegation, t],
  );

  const card = (
    <ThreadDelegationCard
      delegation={props.delegation}
      childBot={props.childBot}
      parentBot={props.parentBot}
      actions={props.actions}
      onAction={onAction}
      childApproval={childApproval.pendingApproval}
      respondingApprovalId={childApproval.respondingApprovalId}
      onRespondToChildApproval={childApproval.respond}
    />
  );

  if (descendants.length === 0) return card;

  const botsById = props.botsById;

  return (
    <View>
      {card}
      {descendants.map((delegation) => (
        <ThreadDelegationDescendantApproval
          key={delegation.delegationId}
          environmentId={environmentId}
          delegation={delegation}
          askerBot={botsById?.get(delegation.childBotId) ?? null}
        />
      ))}
    </View>
  );
}
