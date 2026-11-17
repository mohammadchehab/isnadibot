import {
  BotId,
  EventId,
  HANDOFF_ACTIVITY_KIND,
  HandoffActivityPayload,
  MessageId,
  ResponderTrigger,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import type {
  ProjectionHandoffTurn,
  ProjectionSnapshotQueryShape,
} from "../../Services/ProjectionSnapshotQuery.ts";

const decodeHandoffPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(HandoffActivityPayload),
);

const decodeTrigger = Schema.decodeUnknownOption(Schema.fromJsonString(ResponderTrigger));

/** The bot a turn's trigger asked to hand off, when that is what the trigger says. */
const requestedBotId = (triggerJson: string | null): BotId | null => {
  if (triggerJson === null) return null;

  const trigger = decodeTrigger(triggerJson);

  return Option.isSome(trigger) && trigger.value.kind === "handoff" ? trigger.value.botId : null;
};

/**
 * Answers the one question the handoff reactor asks about a finished turn: was
 * this turn asked to hand off, did it write a note, whose was it, and what
 * message does the cut land after.
 *
 * The cut is the last message before the turn, so the whole handoff turn leaves
 * the bot's context and the note is what carries it forward. A turn that opened
 * the chat has nothing before it, so its cut has no message.
 */
export function createHandoffTurn({ sql }: { readonly sql: SqlClient.SqlClient }) {
  const getHandoffTurn: NonNullable<ProjectionSnapshotQueryShape["getHandoffTurn"]> = (input) =>
    Effect.all({
      activity: sql<{ readonly activityId: string; readonly payload: string }>`
        SELECT
          activity_id AS "activityId",
          payload_json AS "payload"
        FROM projection_thread_activities
        WHERE thread_id = ${input.threadId}
          AND turn_id = ${input.turnId}
          AND kind = ${HANDOFF_ACTIVITY_KIND}
        ORDER BY created_at DESC, activity_id DESC
        LIMIT 1
      `,
      trigger: sql<{ readonly trigger: string | null }>`
        SELECT trigger_json AS "trigger"
        FROM projection_turns
        WHERE thread_id = ${input.threadId}
          AND turn_id = ${input.turnId}
        LIMIT 1
      `,
      sinceMessageId: sql<{ readonly messageId: string }>`
        SELECT before.message_id AS "messageId"
        FROM projection_thread_messages AS before
        JOIN (
          SELECT created_at, message_id
          FROM projection_thread_messages
          WHERE thread_id = ${input.threadId}
            AND turn_id = ${input.turnId}
          ORDER BY created_at ASC, message_id ASC
          LIMIT 1
        ) AS first ON before.thread_id = ${input.threadId}
        WHERE before.created_at < first.created_at
          OR (before.created_at = first.created_at AND before.message_id < first.message_id)
        ORDER BY before.created_at DESC, before.message_id DESC
        LIMIT 1
      `,
    }).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSnapshotQuery.getHandoffTurn:query")),
      Effect.map(({ activity, sinceMessageId, trigger }) => {
        const row = activity[0];
        const requested = requestedBotId(trigger[0]?.trigger ?? null);
        const cut = sinceMessageId[0];
        const since = cut === undefined ? null : MessageId.make(cut.messageId);
        const isRequested = requested !== null;

        if (row !== undefined) {
          // A note that does not decode is no note: the chat says the hand off
          // did not happen rather than cutting a context from a payload it
          // cannot read.
          const note = decodeHandoffPayload(row.payload);

          if (Option.isSome(note)) {
            return Option.some<ProjectionHandoffTurn>({
              botId: note.value.botId,
              requested: isRequested,
              activityId: EventId.make(row.activityId),
              sinceMessageId: since,
            });
          }
        }

        return requested === null
          ? Option.none()
          : Option.some<ProjectionHandoffTurn>({
              botId: requested,
              requested: true,
              activityId: null,
              sinceMessageId: since,
            });
      }),
    );

  return { getHandoffTurn };
}
