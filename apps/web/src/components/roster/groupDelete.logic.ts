import { isOpenWorkItem } from "@isnadi/client-runtime/space/work-items";
import type { WorkItemSummary } from "@isnadi/contracts";

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
export type GroupDeleteRefusal = "open-work-items" | "environment-rights" | "unknown";

/**
 * Read the refusal out of the server's message. The wire carries the
 * invariant's prose and no typed code, so these two markers are the contract:
 * `commandInvariants.ts` for the rights refusal and `decider/groups.ts` for the
 * open-work refusal. Anything else is shown as the server wrote it.
 */
export function classifyGroupDeleteFailure(message: string): GroupDeleteRefusal {
  if (message.includes("open work item(s)") && message.includes("discardWorkItems")) {
    return "open-work-items";
  }

  if (message.includes("needs 'access:write' to change the environment")) {
    return "environment-rights";
  }

  return "unknown";
}
