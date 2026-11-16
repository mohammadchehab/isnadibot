import {
  classifyCommandFailure,
  commandFailureMessage,
  type Translate,
} from "@isnadi/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";

/** The toast one refused routine action shows: the action that failed, and its reason when we have one. */
export type RoutineFailureToast = {
  readonly title: string;
  readonly description?: string;
};

/**
 * The toast for a refused routine command. A refusal code this build knows gets
 * the shared translated sentence, so a stale approval says what changed instead
 * of only which action failed. A code it does not know keeps the action label:
 * the server's own sentence names ids and invariant prose, and decision-84 keeps
 * that out of the default UI.
 */
export function routineFailureToast(
  failure: { readonly cause: Cause.Cause<unknown> },
  t: Translate,
  fallback: string,
): RoutineFailureToast {
  const description =
    classifyCommandFailure(failure) === "unknown"
      ? null
      : commandFailureMessage(failure, { t, fallback });

  return description === null ? { title: fallback } : { title: fallback, description };
}
