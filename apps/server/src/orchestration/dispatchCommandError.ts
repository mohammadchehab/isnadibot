import * as Schema from "effect/Schema";

import { OrchestrationDispatchCommandError } from "@isnadi/contracts";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

const isCommandInvariantError = Schema.is(OrchestrationCommandInvariantError);

const isDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

/**
 * What a client shows when it has no sentence of its own. Already in every
 * catalog as the fallback, so this adds no copy to translate.
 */
const FALLBACK_MESSAGE = "The command failed.";

/**
 * Every client command path funnels its failure through here, so this is the one
 * place a refusal code has to be carried from the invariant onto the wire.
 *
 * What crosses, measured against the wire schema rather than the in-process
 * object: `_tag`, `message`, and `refusal` when the throw carries a code. The
 * command type, the failure arm, the exclusion's written reason, a pending
 * refusal's ticket, and the `cause` do not. `cause` matters because a `Defect`
 * encodes an `Error` as `{ name, message }`, so forwarding it would put the same
 * sentence on the wire a second time.
 *
 * For an invariant throw, `message` depends on whether a code went with it:
 *
 * - Coded: the client renders the code's own sentence from its table, so the
 *   server's detail is redundant on the wire. It is replaced with a fixed
 *   sentence, which is what keeps the detail's bot, group, thread and routine
 *   ids from crossing at the 37 sites that name one.
 * - Uncoded: nothing else can say what happened, so the detail is the sentence
 *   the client prints. That is the arm where a detail still carries whatever
 *   its author wrote; narrowing those is TASK-384, not this module.
 *
 * `refusal` stays a permissive string on the wire, so a code an older client has
 * never heard of degrades to `message` instead of failing the decode and losing
 * the sentence with it.
 */
export const toDispatchCommandError = (cause: unknown, fallbackMessage: string) => {
  if (isDispatchCommandError(cause)) return cause;

  if (isCommandInvariantError(cause)) {
    const { refusal } = cause;

    return new OrchestrationDispatchCommandError({
      message: refusal === undefined ? cause.detail : FALLBACK_MESSAGE,
      ...(refusal === undefined ? {} : { refusal }),
    });
  }

  return new OrchestrationDispatchCommandError({
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
  });
};
