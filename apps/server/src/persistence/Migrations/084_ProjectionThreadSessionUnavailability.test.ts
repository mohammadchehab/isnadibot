import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "084_ProjectionThreadSessionUnavailability",
  (it) => {
    it.effect("adds the column once and reads null for an existing session", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 83 });
        yield* sql`
          INSERT INTO projection_thread_sessions (
            thread_id, status, updated_at
          ) VALUES ('thread-1', 'ready', '2026-01-01')
        `;

        yield* runMigrations({ toMigrationInclusive: 84 });
        yield* runMigrations({ toMigrationInclusive: 84 });

        const columns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_thread_sessions)
        `;

        assert.equal(columns.filter((column) => column.name === "unavailability").length, 1);

        const rows = yield* sql<{ readonly unavailability: string | null }>`
          SELECT unavailability FROM projection_thread_sessions WHERE thread_id = 'thread-1'
        `;

        assert.deepEqual(rows, [{ unavailability: null }]);
      }),
    );
  },
);
