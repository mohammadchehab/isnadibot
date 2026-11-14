import { isOpenWorkItem } from "@isnadi/client-runtime/space/work-items";
import { CommandRefusal, type WorkItemSummary } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { Predicate, Schema } from "effect";

const isCommandRefusal = Schema.is(CommandRefusal);

/**
 * How many open items a group still holds. The shell carries open items only,
 * and the decider counts them the same way, so the number named in the
 * confirmation is the number its refusal would name.
 */
export function openWorkItemCountForGroup(
  items: readonly WorkItemSummary[],
  groupId: string,
): number {
  return items.filter((item) => item.groupId === groupId && isOpenWorkItem(item.state)).length;
}

/** Which of `group.delete`'s refusals came back. */
export type GroupDeleteRefusal = CommandRefusal | "unknown";

/**
 * Read the refusal code the server attached to a failed delete. The wire field
 * is a permissive string, so a code this client does not know — one a newer
 * server added — is `unknown`, and the caller falls back to the server's own
 * sentence instead of guessing.
 */
export function classifyGroupDeleteFailure(failure: {
  readonly cause: Cause.Cause<unknown>;
}): GroupDeleteRefusal {
  const error = Cause.squash(failure.cause);

  const refusal =
    Predicate.isObjectOrArray(error) && error !== null && "refusal" in error
      ? error.refusal
      : undefined;

  return isCommandRefusal(refusal) ? refusal : "unknown";
}
