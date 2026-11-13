import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_groups)`;

  // Whether the fleet dispatcher keeps idle members of this group working. Groups created before
  // this column existed stay off, which is exactly how they behaved.
  if (!columns.some((column) => column.name === "keep_busy")) {
    yield* sql`ALTER TABLE projection_groups ADD COLUMN keep_busy INTEGER NOT NULL DEFAULT 0`;
  }
});
