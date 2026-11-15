import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const botColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_bots)
  `;

  // The bot that created this row, or NULL when a person did. Rows written before this column
  // existed read NULL, which is exactly what they meant: a person created them.
  if (!botColumns.some((column) => column.name === "created_by_bot_id")) {
    yield* sql`ALTER TABLE projection_bots ADD COLUMN created_by_bot_id TEXT`;
  }

  // The same shape on a space, so one field carries "a bot made this" for both entities.
  const groupColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_groups)
  `;

  if (!groupColumns.some((column) => column.name === "created_by_bot_id")) {
    yield* sql`ALTER TABLE projection_groups ADD COLUMN created_by_bot_id TEXT`;
  }
});
