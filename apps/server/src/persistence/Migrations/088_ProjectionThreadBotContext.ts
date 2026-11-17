import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // One row per (chat, bot): the bot's current context cut, the cut it had
  // before so Undo can restore it, and the handoff note the chat shows. A bot
  // with no row reads the whole chat, which is what every bot did before this
  // table existed. `previous_*` is NULL when the bot had no cut, so Undo on a
  // bot's first reset restores the whole chat.
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_bot_context (
      thread_id TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      since_sequence INTEGER NOT NULL,
      since_message_id TEXT NOT NULL,
      handoff_activity_id TEXT,
      previous_since_sequence INTEGER,
      previous_since_message_id TEXT,
      reset_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, bot_id)
    )
  `;
});
