/**
 * Where a delegated chat's approval is answered from, and what the answer names.
 *
 * The child chat is deliberately not listed in the app — child work only ever
 * shows as a card in the parent chat — so the card is the only surface that can
 * answer its approval. Kept free of React and connection state so the routing
 * can be tested without a renderer.
 *
 * @module features/threads/childThreadApproval
 */
import { presentDelegation } from "@isnadi/client-runtime/delegation-presentation";
import type {
  ApprovalRequestId,
  EnvironmentId,
  IsnadiDelegationRecord,
  ProviderApprovalDecision,
  ScopedThreadRef,
} from "@isnadi/contracts";

/**
 * The chat a delegation runs in. `null` until the child chat exists (a queued
 * delegation has none yet), so callers can read it without a phase switch.
 */
export function delegationChildThreadRef(
  environmentId: EnvironmentId,
  delegation: IsnadiDelegationRecord,
): ScopedThreadRef | null {
  const childThreadId = presentDelegation(delegation).childThreadId;

  return childThreadId === null ? null : { environmentId, threadId: childThreadId };
}

/**
 * The command that answers a delegated chat's approval.
 *
 * It names the child thread on purpose. The request id belongs to the child, so
 * an answer aimed at the parent chat has no request to resolve and leaves the
 * delegated turn parked forever.
 */
export function childApprovalCommand(
  threadRef: ScopedThreadRef,
  requestId: ApprovalRequestId,
  decision: ProviderApprovalDecision,
) {
  return {
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, requestId, decision },
  };
}
