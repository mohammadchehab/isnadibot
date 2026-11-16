import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { fromLenientJson } from "@isnadi/shared/schemaJson";

/**
 * Matches the message `@mastra/mcp` raises when an authorization server
 * refuses dynamic client registration. The manager copies that message into
 * the server's status error and the controller wraps it again, so the
 * authorization server's own answer survives to here.
 */
const registrationRejection = /Dynamic Client Registration rejected \(HTTP (\d{3})\): ([\s\S]*)$/u;

const RegistrationErrorBody = Schema.Struct({
  error_description: Schema.optional(Schema.String),
});

const decodeRegistrationErrorBody = Schema.decodeUnknownOption(
  fromLenientJson(RegistrationErrorBody),
);

/**
 * The sentence a client shows when a bot cannot authenticate an MCP server.
 *
 * A refused registration is an answer from the authorization server, so the
 * client repeats the server's own description instead of claiming the server
 * could not be reached.
 */
export function describeMcpAuthenticationFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const rejection = registrationRejection.exec(message);
  const status = rejection?.[1];
  const body = rejection?.[2];

  if (status === undefined || body === undefined) return "The MCP server could not be reached.";

  const parsed = decodeRegistrationErrorBody(body);
  const description = Option.isSome(parsed) ? parsed.value.error_description : undefined;

  return description === undefined
    ? `The authorization server refused to register IsnadiBot (HTTP ${status}).`
    : `The authorization server refused to register IsnadiBot (HTTP ${status}): ${description}`;
}
