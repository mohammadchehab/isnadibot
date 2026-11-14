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
export const CommandRefusalCodes = ["open-work-items", "environment-rights"] as const;

export const CommandRefusal = Schema.Literals(CommandRefusalCodes);

export type CommandRefusal = typeof CommandRefusal.Type;
