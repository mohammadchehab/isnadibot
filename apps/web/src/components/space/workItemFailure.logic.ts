import {
  classifyCommandFailure,
  commandFailureMessage,
} from "@isnadi/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";

type Translate = (message: string) => string;

/** The toast a work-item command shows when it fails. */
export interface WorkItemFailureToast {
  readonly type: "error";
  readonly title: string;
  readonly description?: string;
}

/**
 * The toast for a work-item command that failed, naming the reason when this
 * client understands the refusal.
 *
 * Only a code this build knows may carry a description. The server's own
 * sentence for an uncoded throw names whatever ids it was given, so a code this
 * client does not know keeps the surface's title alone rather than printing it.
 *
 * The title is the caller's own wording, because the two surfaces that dispatch
 * work-item commands say what the person was doing ("Could not update the card",
 * "Could not save the owner") and that context is worth more than one shared
 * noun. Sharing this decision is the point: a refusal coded for one surface is
 * never silently unhandled on the other.
 */
export function workItemFailureToast(
  input: {
    readonly cause: Cause.Cause<unknown>;
    readonly title: string;
  },
  t: Translate,
): WorkItemFailureToast {
  if (classifyCommandFailure({ cause: input.cause }) === "unknown") {
    return { type: "error", title: input.title };
  }

  return {
    type: "error",
    title: input.title,
    description: commandFailureMessage({ cause: input.cause }, { t }),
  };
}
