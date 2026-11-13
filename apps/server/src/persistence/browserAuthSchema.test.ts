import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Layers/Sqlite.ts";

/**
 * The browser-auth tables hold metadata only. Ciphertext lives on disk and secrets live in the
 * vault, so the scan refuses a BLOB column and any name that promises one.
 */
const browserAuthTables = [
  "projection_browser_profiles",
  "projection_browser_auth_requests",
  "projection_browser_session_grants",
  "browser_profile_leases",
  "browser_profile_checks",
] as const;

/** `fencing_token` is a counter, the one column whose name a token rule may not reject. */
const allowedNames = new Set(["fencing_token"]);

const forbiddenName =
  /blob|ciphertext|data|storage|answer|payload|cookie|token|password|secret|key|path/;

const schemaLayer = it.layer(SqlitePersistenceMemory);

schemaLayer("browser-auth schema", (it) => {
  it.effect("no browser-auth column is a BLOB or a name that promises a secret", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      for (const table of browserAuthTables) {
        const columns = yield* sql<{
          readonly name: string;
          readonly type: string;
        }>`SELECT name, type FROM pragma_table_info(${table})`;

        assert.isAbove(columns.length, 0, `${table} should exist`);

        for (const column of columns) {
          assert.notMatch(column.type, /blob/i, `${table}.${column.name} is a ${column.type}`);

          if (allowedNames.has(column.name)) {
            continue;
          }

          assert.notMatch(
            column.name,
            forbiddenName,
            `${table}.${column.name} is a secret-shaped column`,
          );
        }
      }
    }),
  );
});
