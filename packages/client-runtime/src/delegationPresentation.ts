import * as Predicate from "effect/Predicate";
import {
  ISNADI_DELEGATION_TRANSITIONS,
  isnadiDelegationStateOf,
  isIsnadiDelegationTerminal,
  isThreadWaitingOnChildren,
  type IsnadiDelegationRecord,
  type IsnadiDelegationState,
  type IsnadiDelegationTrigger,
  type ThreadId,
} from "@isnadi/contracts";
import { withoutErrorStack } from "@isnadi/shared/errorText";

/**
 * Whether the parent bot has received a finished result. Completed and failed
 * work is delivered once, to the parent's next turn or its CheckAgent call.
 * Canceled and unfinished work has no delivery state.
 */
export type DelegationDelivery = "pending" | "delivered";

export interface DelegationPresentation {
  readonly state: IsnadiDelegationState;
  readonly terminal: boolean;
  readonly outcome:
    | { readonly kind: "result"; readonly text: string }
    | { readonly kind: "failure"; readonly text: string }
    | { readonly kind: "blocked"; readonly text: string }
    | null;
  readonly delivery: DelegationDelivery | null;
  /** The child's chat, once the work has started. Opens the read-only detail view. */
  readonly childThreadId: ThreadId | null;
  /** Scheduled work comes from a routine, not from the parent bot's reply. */
  readonly trigger: IsnadiDelegationTrigger;
  /** Whether this card retries earlier Failed or Canceled work. */
  readonly retried: boolean;
}

/** Card state shared by the web and mobile delegation views. */
export function presentDelegation(delegation: IsnadiDelegationRecord): DelegationPresentation {
  const phase = delegation.phase;
  const state = isnadiDelegationStateOf(phase);

  const delivery: DelegationDelivery | null =
    Predicate.isTagged(phase, "Completed") || Predicate.isTagged(phase, "Failed")
      ? phase.acknowledgedAt === null
        ? "pending"
        : "delivered"
      : null;

  return {
    state,
    terminal: isIsnadiDelegationTerminal(phase),
    // Records written before the phase union can decode without details; the text is then empty.
    // Older failures stored a full server stack, so only its first readable line is shown.
    outcome: Predicate.isTagged(phase, "Completed")
      ? { kind: "result", text: phase.result?.summary ?? "" }
      : Predicate.isTagged(phase, "Failed")
        ? { kind: "failure", text: withoutErrorStack(phase.failure?.message ?? "") }
        : Predicate.isTagged(phase, "Blocked")
          ? { kind: "blocked", text: withoutErrorStack(phase.reason) }
          : null,
    delivery,
    childThreadId: isQueuedPhase(phase) ? null : phase.childThreadId,
    trigger: delegation.trigger,
    retried: delegation.retryOfDelegationId !== null,
  };
}

/**
 * Milliseconds the work has run: from start (or creation while queued) to its
 * end, or to `now` while it is live. Null when the timestamps do not parse.
 */
export function delegationElapsedMs(
  delegation: IsnadiDelegationRecord,
  now: number,
): number | null {
  const phase = delegation.phase;

  const startedAt = Date.parse(
    isQueuedPhase(phase) || phase.startedAt === null ? delegation.createdAt : phase.startedAt,
  );

  const endedAt =
    Predicate.isTagged(phase, "Failed") ||
    Predicate.isTagged(phase, "Canceled") ||
    Predicate.isTagged(phase, "Completed")
      ? Date.parse(phase.completedAt)
      : now;

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) return null;

  return endedAt - startedAt;
}

/** Delegations a chat started, oldest first, and whether any are still working. */
type ThreadDelegationsResult = {
  readonly delegations: ReadonlyArray<IsnadiDelegationRecord>;
  readonly waitingOnChildren: boolean;
};

export function threadDelegations(
  delegations: ReadonlyArray<IsnadiDelegationRecord>,
  threadId: ThreadId,
): ThreadDelegationsResult {
  return {
    delegations: delegations.filter((delegation) => delegation.parentThreadId === threadId),
    waitingOnChildren: isThreadWaitingOnChildren(delegations, threadId),
  };
}

/**
 * Every delegation started by this chat or by any chat it started, transitively.
 * The contract caps delegation depth, so the walk is short, but it follows the
 * chain rather than assuming exactly one more level.
 *
 * A nested delegation's card belongs to the feed of the chat that started it,
 * and that chat is not listed in the roster, so the card one level up is the
 * last surface that can show or answer it.
 */
export function descendantDelegations(
  delegations: ReadonlyArray<IsnadiDelegationRecord>,
  threadId: ThreadId,
): ReadonlyArray<IsnadiDelegationRecord> {
  const found: IsnadiDelegationRecord[] = [];
  const seenDelegationIds = new Set<string>();
  const seenThreads = new Set<ThreadId>([threadId]);
  let parents: ReadonlyArray<ThreadId> = [threadId];

  while (parents.length > 0) {
    const next: ThreadId[] = [];

    for (const delegation of delegations) {
      if (!parents.includes(delegation.parentThreadId)) continue;

      if (seenDelegationIds.has(delegation.delegationId)) continue;

      seenDelegationIds.add(delegation.delegationId);
      found.push(delegation);

      const childThreadId = presentDelegation(delegation).childThreadId;

      if (childThreadId !== null && !seenThreads.has(childThreadId)) {
        seenThreads.add(childThreadId);
        next.push(childThreadId);
      }
    }

    parents = next;
  }

  return found;
}

/**
 * Whether a later record already retries this one. The decider refuses a
 * second retry of the same record, so a superseded card offers no Try again.
 */
export function isDelegationSuperseded(
  delegation: IsnadiDelegationRecord,
  delegations: ReadonlyArray<IsnadiDelegationRecord>,
): boolean {
  return delegations.some((candidate) => candidate.retryOfDelegationId === delegation.delegationId);
}

/**
 * What a user can do with one piece of bot work. "Let it finish" keeps the work
 * running when its parent chat stops; cancel belongs in an overflow menu; retry
 * starts new work from a failed or canceled record without touching it, once.
 * Pass the chat's delegations so a record that was already retried offers nothing.
 */
export type DelegationAction = "keep" | "cancel" | "retry";

export function delegationActions(
  delegation: IsnadiDelegationRecord,
  delegations: ReadonlyArray<IsnadiDelegationRecord>,
): ReadonlyArray<DelegationAction> {
  const phase = delegation.phase._tag;

  if (phase === "Failed" || phase === "Canceled") {
    return isDelegationSuperseded(delegation, delegations) ? [] : ["retry"];
  }

  if (phase === "Completed") return [];
  const actions: DelegationAction[] = [];

  if (!delegation.keep) actions.push("keep");

  if (ISNADI_DELEGATION_TRANSITIONS[phase].has("Canceled")) actions.push("cancel");

  return actions;
}

function isQueuedPhase(
  value: IsnadiDelegationRecord["phase"],
): value is Extract<IsnadiDelegationRecord["phase"], { readonly _tag: "Queued" }> {
  return Predicate.isTagged(value, "Queued");
}
