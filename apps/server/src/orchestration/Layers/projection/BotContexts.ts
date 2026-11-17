import * as Effect from "effect/Effect";
import { toPersistenceSqlError } from "../../../persistence/Errors.ts";
import { type ProjectionDependencies, type ProjectorDefinition } from "./Definitions.ts";

export const BOT_CONTEXT_EVENT_TYPES = [
  "thread.context-reset",
  "thread.context-reset-undone",
  "thread.deleted",
] as const;

/**
 * Keeps `projection_thread_bot_context` in step with the context-epoch events:
 * one row per bot that has a cut in this chat, holding the cut, the cut it
 * replaced (for Undo) and the handoff note the chat shows.
 */
export function createBotContexts({ sql }: Pick<ProjectionDependencies, "sql">) {
  const applyBotContextsProjection: ProjectorDefinition["apply"] = Effect.fn(
    "applyBotContextsProjection",
  )((event, _attachmentSideEffects) => {
    if (event.type === "thread.deleted") {
      return sql`
        DELETE FROM projection_thread_bot_context
        WHERE thread_id = ${event.payload.threadId}
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionPipeline.applyBotContextsProjection:delete"),
        ),
      );
    }

    if (event.type === "thread.context-reset") {
      const reset = event.payload;

      // The row's current cut becomes the previous one, so Undo has something to
      // restore. A bot reset for the first time keeps NULL there: its previous
      // state was "no cut", which Undo restores by deleting the row.
      return sql`
        INSERT INTO projection_thread_bot_context (
          thread_id, bot_id, since_sequence, since_message_id, handoff_activity_id,
          previous_since_sequence, previous_since_message_id, reset_at
        )
        VALUES (
          ${reset.threadId},
          ${reset.botId},
          ${reset.sinceSequence},
          ${reset.sinceMessageId},
          ${reset.handoffActivityId ?? null},
          NULL,
          NULL,
          ${reset.resetAt}
        )
        ON CONFLICT (thread_id, bot_id) DO UPDATE SET
          previous_since_sequence = projection_thread_bot_context.since_sequence,
          previous_since_message_id = projection_thread_bot_context.since_message_id,
          since_sequence = excluded.since_sequence,
          since_message_id = excluded.since_message_id,
          handoff_activity_id = excluded.handoff_activity_id,
          reset_at = excluded.reset_at
      `.pipe(
        Effect.asVoid,
        Effect.mapError(
          toPersistenceSqlError("ProjectionPipeline.applyBotContextsProjection:reset"),
        ),
      );
    }

    if (event.type !== "thread.context-reset-undone") {
      return Effect.void;
    }

    const undone = event.payload;

    // No previous cut means the bot reads the whole chat again: the row goes.
    // A previous cut is restored with no note, because an undone handoff leaves
    // the note in the chat without putting it back in the bot's context.
    return Effect.gen(function* () {
      // Delete first: the update below clears `previous_since_sequence`, and a
      // delete that ran after it would match the row it just restored.
      yield* sql`
        DELETE FROM projection_thread_bot_context
        WHERE thread_id = ${undone.threadId}
          AND bot_id = ${undone.botId}
          AND previous_since_sequence IS NULL
      `;

      yield* sql`
        UPDATE projection_thread_bot_context
        SET
          since_sequence = previous_since_sequence,
          since_message_id = previous_since_message_id,
          handoff_activity_id = NULL,
          previous_since_sequence = NULL,
          previous_since_message_id = NULL,
          reset_at = ${undone.undoneAt}
        WHERE thread_id = ${undone.threadId}
          AND bot_id = ${undone.botId}
          AND previous_since_sequence IS NOT NULL
      `;
    }).pipe(
      Effect.asVoid,
      Effect.mapError(toPersistenceSqlError("ProjectionPipeline.applyBotContextsProjection:undo")),
    );
  });

  return { applyBotContextsProjection };
}
