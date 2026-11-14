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
  /**
   * A stale click, not a permissions problem: the bot the client offered is no
   * longer in the group, so the roster it drew came from a view the server has
   * already left behind. Its remedy is a refresh, which is why it cannot share
   * `actor-not-a-group-member` above — that one is about the person, this one
   * about the bot they picked.
   */
  "bot-not-a-group-member",
  /**
   * The bot being assigned is not the boss; another bot is. `bot-is-group-boss`
   * would tell the user something false about the bot they picked, so the two
   * stay separate even though both end in the same remedy.
   */
  "group-already-has-boss",
] as const;

export const CommandRefusal = Schema.Literals(CommandRefusalCodes);

export type CommandRefusal = typeof CommandRefusal.Type;
