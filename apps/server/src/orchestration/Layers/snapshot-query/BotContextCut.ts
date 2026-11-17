import { HandoffActivityPayload, MessageId } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import type {
  ProjectionBotContextCut,
  ProjectionSnapshotQueryShape,
} from "../../Services/ProjectionSnapshotQuery.ts";

const decodeHandoffPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(HandoffActivityPayload),
);

/** The note a cut points at, or null when the cut has none that still decodes. */
function handoffDocOf(payloadJson: string | null): ProjectionBotContextCut["handoffDoc"] {
  if (payloadJson === null) return null;

  const payload = decodeHandoffPayload(payloadJson);

  return Option.isSome(payload) ? payload.value.doc : null;
}

/**
 * Reads one bot's context cut in one chat, with the note the cut was made from.
 * The note lives in the activity the reset points at, so a cut whose pointer was
 * cleared (an undo) reads as a cut with no note.
 */
export function createBotContextCut({ sql }: { readonly sql: SqlClient.SqlClient }) {
  const getBotContextCut: NonNullable<ProjectionSnapshotQueryShape["getBotContextCut"]> = (input) =>
    sql<{
      readonly sinceMessageId: string;
      readonly sinceSequence: number;
      readonly resetAt: string;
      readonly payload: string | null;
      readonly repliesAfterCut: number;
      readonly inGroup: number;
    }>`
      SELECT
        context.since_message_id AS "sinceMessageId",
        context.since_sequence AS "sinceSequence",
        context.reset_at AS "resetAt",
        activity.payload_json AS "payload",
        (
          SELECT COUNT(*) FROM projection_thread_messages AS message
          WHERE message.thread_id = context.thread_id
            AND message.role = 'assistant'
            AND julianday(message.created_at) >= julianday(context.reset_at)
        ) AS "repliesAfterCut",
        (
          SELECT COUNT(*) FROM projection_threads AS thread
          WHERE thread.thread_id = context.thread_id AND thread.group_id IS NOT NULL
        ) AS "inGroup"
      FROM projection_thread_bot_context AS context
      LEFT JOIN projection_thread_activities AS activity
        ON activity.activity_id = context.handoff_activity_id
      WHERE context.thread_id = ${input.threadId}
        AND context.bot_id = ${input.botId}
      LIMIT 1
    `.pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionSnapshotQuery.getBotContextCut:query")),
      Effect.map((rows) => {
        const row = rows[0];

        if (row === undefined) return Option.none<ProjectionBotContextCut>();

        return Option.some<ProjectionBotContextCut>({
          sinceMessageId: MessageId.make(row.sinceMessageId),
          sinceSequence: row.sinceSequence,
          resetAt: row.resetAt,
          handoffDoc: handoffDocOf(row.payload),
          // A group chat cannot say which member answered, so only a direct chat
          // can tell that the bot has already read its note.
          docSpent: row.inGroup === 0 && row.repliesAfterCut > 0,
        });
      }),
    );

  return { getBotContextCut };
}
