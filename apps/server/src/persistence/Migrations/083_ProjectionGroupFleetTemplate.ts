import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_groups)`;

  // The fleet template a group was hired from; NULL means a group made by hand.
  if (!columns.some((column) => column.name === "fleet_template_id")) {
    yield* sql`ALTER TABLE projection_groups ADD COLUMN fleet_template_id TEXT`;
  }
});
