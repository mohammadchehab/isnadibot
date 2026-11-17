import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { BotId, EventId, TrimmedString, TurnId } from "./baseSchemas.ts";

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

/**
 * The activity kind the server appends when a requested handoff did happen: the
 * note is in the chat and that bot's context now starts after the cut. It is the
 * chat's own record of the reset, because the cut itself is a server-side
 * projection the clients never see.
 */
export const HANDOFF_APPLIED_ACTIVITY_KIND = "handoff.applied";

/**
 * What an applied handoff carries: whose cut it was, the turn that wrote the
 * note, and the note's own activity so the chat can tie the two together.
 */
export const HandoffAppliedActivityPayload = Schema.Struct({
  botId: BotId,
  turnId: TurnId,
  handoffActivityId: EventId,
});

export type HandoffAppliedActivityPayload = typeof HandoffAppliedActivityPayload.Type;

/**
 * Why a requested handoff reset nothing. `no-note` is a turn that ended without
 * calling the tool; `turn-not-completed` is a note whose turn was interrupted or
 * errored before the cut could land; `reset-refused` is a completed note whose
 * cut the chat could no longer take, because a revert moved the message it
 * landed after.
 */
export const HandoffNotAppliedReason = Schema.Literals([
  "no-note",
  "turn-not-completed",
  "reset-refused",
]);

export type HandoffNotAppliedReason = typeof HandoffNotAppliedReason.Type;

export const HandoffNotAppliedActivityPayload = Schema.Struct({
  botId: BotId,
  turnId: TurnId,
  reason: HandoffNotAppliedReason,
});

export type HandoffNotAppliedActivityPayload = typeof HandoffNotAppliedActivityPayload.Type;

/**
 * The prefix on the server's own "hand off now" message. The brief is a user-role
 * message like any other, so a client tells it apart by this prefix and keeps it
 * out of the transcript the user reads.
 */
export const HANDOFF_REQUEST_MESSAGE_PREFIX = "handoff:";
