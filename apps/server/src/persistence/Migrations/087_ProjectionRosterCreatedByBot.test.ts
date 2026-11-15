import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "087_ProjectionRosterCreatedByBot",
  (it) => {
    it.effect(
      "adds one column to each roster table and reads null for rows written before it",
      () =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations({ toMigrationInclusive: 84 });
          yield* sql`
          INSERT INTO projection_bots (bot_id, name, title, avatar_json, created_at, updated_at)
          VALUES ('bot-1', 'Boss', 'Agent', '{"kind":"dither","seed":"bot-1"}', '2026-01-01', '2026-01-01')
        `;
          yield* sql`
          INSERT INTO projection_groups (group_id, name, created_at, updated_at)
          VALUES ('group-1', 'Space', '2026-01-01', '2026-01-01')
        `;

          yield* runMigrations({ toMigrationInclusive: 87 });
          yield* runMigrations({ toMigrationInclusive: 87 });

          const botColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_bots)
        `;

          const groupColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_groups)
        `;

          assert.equal(
            botColumns.filter((column) => column.name === "created_by_bot_id").length,
            1,
          );
          assert.equal(
            groupColumns.filter((column) => column.name === "created_by_bot_id").length,
            1,
          );

          const bots = yield* sql<{ readonly createdByBotId: string | null }>`
          SELECT created_by_bot_id AS "createdByBotId" FROM projection_bots WHERE bot_id = 'bot-1'
        `;

          const groups = yield* sql<{ readonly createdByBotId: string | null }>`
          SELECT created_by_bot_id AS "createdByBotId" FROM projection_groups WHERE group_id = 'group-1'
        `;

          assert.deepEqual(bots, [{ createdByBotId: null }]);
          assert.deepEqual(groups, [{ createdByBotId: null }]);
        }),
    );
  },
);
