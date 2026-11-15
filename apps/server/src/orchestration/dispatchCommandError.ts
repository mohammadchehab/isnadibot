import * as Schema from "effect/Schema";

import { OrchestrationDispatchCommandError } from "@isnadi/contracts";

import { OrchestrationCommandInvariantError } from "./Errors.ts";

const isCommandInvariantError = Schema.is(OrchestrationCommandInvariantError);

const isDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

/**
 * Every client command path funnels its failure through here, so this is the one
 * place a refusal code has to be carried from the invariant onto the wire.
 *
 * It copies `message` and `refusal` and drops everything else. That is what keeps
 * the failure classification server-side: an `excluded` throw's written reason
 * and a `pending-refusal`'s ticket name internal command types and identifiers,
 * and neither may reach a client. `refusal` stays a permissive string on the
 * wire, so a code an older client has never heard of degrades to `message`
 * instead of failing the decode and losing the sentence with it.
 */
export const toDispatchCommandError = (cause: unknown, fallbackMessage: string) => {
  if (isDispatchCommandError(cause)) return cause;

  const refusal = isCommandInvariantError(cause) ? cause.refusal : undefined;

  return new OrchestrationDispatchCommandError({
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
    ...(refusal === undefined ? {} : { refusal }),
  });
};
