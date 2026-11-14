import * as Schema from "effect/Schema";

/**
 * Why the server refused a command, when the client has a dedicated path for
 * it. The code is attached at the throw site, so a refusal's reason never has
 * to be recovered from the prose in `message`.
 *
 * The wire field that carries this (`OrchestrationDispatchCommandError.refusal`)
 * is deliberately a permissive string: the client decodes the whole exit, so a
 * code it does not know must degrade to `message` rather than fail the decode.
 * This set is what a current client can switch on.
 */
export const CommandRefusalCodes = [
  "open-work-items",
  "environment-rights",
  "bot-is-group-boss",
  "group-would-be-undersized",
  "delegation-limit-reached",
  "delegation-would-cycle",
  /**
   * Authorization, not a business rule: the actor is neither a member of the
   * group nor allowed to manage groups, so no change to the group would let the
   * command through. Its remedy is access, not a different edit, which is why it
   * stays a literal of its own instead of folding into the boss or undersized
   * refusals above.
   */
  "actor-not-a-group-member",
] as const;

export const CommandRefusal = Schema.Literals(CommandRefusalCodes);

export type CommandRefusal = typeof CommandRefusal.Type;
