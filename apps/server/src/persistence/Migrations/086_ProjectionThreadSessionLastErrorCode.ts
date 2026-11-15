import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;

  // The code behind `last_error`'s prose, so a surface renders the sentence from the shared map and
  // can tell the causes apart. Sessions written before this column existed read NULL, which means
  // "only the prose" — exactly how they behaved before.
  if (!columns.some((column) => column.name === "last_error_code")) {
    yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN last_error_code TEXT`;
  }
});
