import { Predicate } from "effect";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@isnadi/client-runtime/state/runtime";
import type {
  ApprovalRequestId,
  OrchestrationThreadActivity,
  ProviderApprovalDecision,
  ScopedThreadRef,
} from "@isnadi/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";

import { useMobileI18n } from "../../lib/i18n";
import { derivePendingApprovals } from "../../lib/threadActivity";
import { environmentThreadDetails, threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { childApprovalCommand } from "./childThreadApproval";

const NO_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];

const NO_ACTIVITIES_ATOM = Atom.make(NO_ACTIVITIES).pipe(
  Atom.withLabel("mobile-child-thread-activities:empty"),
);

/**
 * The approval a delegated chat is parked on, answered from the parent chat.
 *
 * The child chat is deliberately not listed in the app (child work only ever
 * shows as a card in the parent chat), so the card is the only place its
 * approval can be answered. The answer always names the CHILD thread: the
 * parent thread has no request with this id and would refuse it.
 */
export function useChildThreadApproval(threadRef: ScopedThreadRef | null) {
  const { t } = useMobileI18n();

  const activities = useAtomValue(
    threadRef === null ? NO_ACTIVITIES_ATOM : environmentThreadDetails.activitiesAtom(threadRef),
  );

  const pendingApprovals = useMemo(() => derivePendingApprovals(activities), [activities]);

  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });

  const [respondingApprovalId, setRespondingApprovalId] = useState<ApprovalRequestId | null>(null);

  const respond = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      if (threadRef === null) return;

      setRespondingApprovalId(requestId);

      const result = await respondToApproval(childApprovalCommand(threadRef, requestId, decision));

      setRespondingApprovalId((current) => (current === requestId ? null : current));

      if (Predicate.isTagged(result, "Failure")) {
        const error = squashAtomCommandFailure(result);

        Alert.alert(
          t("Could not answer the approval"),
          error instanceof Error ? error.message : undefined,
        );
      }

      return result;
    },
    [respondToApproval, t, threadRef],
  );

  return {
    pendingApproval: pendingApprovals[0] ?? null,
    respondingApprovalId,
    respond,
  };
}
