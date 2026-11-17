import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BotId, TrimmedString } from "./baseSchemas.ts";

/** One field of a handoff doc. The six rows the chat renders are the six fields. */
export const HANDOFF_DOC_FIELD_MAX_LENGTH = 2000;

const HandoffDocField = TrimmedString.check(Schema.isMaxLength(HANDOFF_DOC_FIELD_MAX_LENGTH));

const OptionalHandoffDocField = Schema.optional(HandoffDocField).pipe(
  Schema.withDecodingDefault(Effect.succeed("")),
);

/**
 * What a bot leaves behind when it hands its context over: the six rows the chat
 * shows, in this order. `nextStep` is the one a reader needs, so it is the only
 * required field; the others decode to "" when the bot has nothing to say.
 */
export const HandoffDoc = Schema.Struct({
  item: OptionalHandoffDocField,
  branch: OptionalHandoffDocField,
  done: OptionalHandoffDocField,
  nextStep: HandoffDocField.check(Schema.isNonEmpty()),
  waitingOn: OptionalHandoffDocField,
  doNot: OptionalHandoffDocField,
});

export type HandoffDoc = typeof HandoffDoc.Type;

/** The activity kind a handoff doc is appended to the chat as. */
export const HANDOFF_ACTIVITY_KIND = "handoff";

/** The tool a bot calls to write a handoff doc. */
export const ISNADI_HANDOFF_TOOL_NAME = "handoff";

/**
 * What a handoff activity carries: the note, and the bot whose context it cuts,
 * so the reset lands on the bot that wrote it even in a group chat.
 */
export const HandoffActivityPayload = Schema.Struct({
  botId: BotId,
  doc: HandoffDoc,
});

export type HandoffActivityPayload = typeof HandoffActivityPayload.Type;

/**
 * The activity kind the server appends when a requested handoff did not happen,
 * so the chat can say so instead of the reset silently not landing.
 */
export const HANDOFF_NOT_APPLIED_ACTIVITY_KIND = "handoff.not-applied";
