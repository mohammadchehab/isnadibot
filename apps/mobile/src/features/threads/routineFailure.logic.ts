import {
  classifyCommandFailure,
  commandFailureMessage,
  type Translate,
} from "@isnadi/client-runtime/state/runtime";
import type * as Cause from "effect/Cause";

/**
 * The sentence the routine card shows for a refused action. A refusal code this
 * build knows gets the shared translated sentence, so a stale approval says what
 * changed instead of only which action failed. A code it does not know keeps the
 * card's own copy: the server's own sentence is technical English, and
 * decision-84 keeps that out of the default UI.
 */
export function routineFailureMessage(
  failure: { readonly cause: Cause.Cause<unknown> },
  t: Translate,
  fallback: string,
): string {
  return classifyCommandFailure(failure) === "unknown"
    ? fallback
    : commandFailureMessage(failure, { t, fallback });
}
