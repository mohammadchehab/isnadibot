import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_thread_sessions)
  `;

  // Why a session cannot be used right now, such as a revoked sign-in. Sessions written before this
  // column existed read NULL, which means "no category" — exactly how they behaved before.
  if (!columns.some((column) => column.name === "unavailability")) {
    yield* sql`ALTER TABLE projection_thread_sessions ADD COLUMN unavailability TEXT`;
  }
});
