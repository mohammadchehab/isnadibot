import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_turns)
  `;

  // When the turn's provider last produced output before going quiet. Turns written before this
  // column existed read NULL, which means "not silent" — exactly how they behaved before.
  if (!columns.some((column) => column.name === "silent_at")) {
    yield* sql`ALTER TABLE projection_turns ADD COLUMN silent_at TEXT`;
  }
});
