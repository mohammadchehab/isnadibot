import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

interface RequestRow {
  readonly request_id?: string;
  readonly kind?: string;
  readonly requested_by?: string;
  readonly bot_id?: string | null;
  readonly thread_id?: string | null;
  readonly tool_call_id?: string | null;
  readonly site?: string;
  readonly reason?: string | null;
  readonly profile_id?: string | null;
  readonly state?: string;
  readonly submitting?: number;
  readonly asking_elapsed_ms?: number;
}

/**
 * Foreign keys are per connection and the server turns them on at startup; so does the test.
 * The client is shared by the whole file, so each test starts from empty tables.
 */
const migrateWithForeignKeys = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`PRAGMA foreign_keys = ON`;
  yield* runMigrations();
  yield* sql`DELETE FROM projection_browser_auth_requests`;
  yield* sql`DELETE FROM projection_browser_profiles`;

  return sql;
});

const insertProfile = (sql: SqlClient.SqlClient, profileId: string, site: string, generation = 1) =>
  sql`
    INSERT INTO projection_browser_profiles (
      profile_id, site, route, generation, status, health, created_at, updated_at
    ) VALUES (${profileId}, ${site}, 'direct', ${generation}, 'signed-in', 'unknown',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `;

const insertRequest = (sql: SqlClient.SqlClient, row: RequestRow = {}) =>
  sql`
    INSERT INTO projection_browser_auth_requests (
      request_id, kind, requested_by, bot_id, thread_id, tool_call_id, site, reason,
      profile_id, state, submitting, asking_elapsed_ms, asking_since, created_at, updated_at
    ) VALUES (
      ${row.request_id ?? "request-1"},
      ${row.kind ?? "sign-in"},
      ${row.requested_by ?? "bot"},
      ${row.bot_id === undefined ? "bot-1" : row.bot_id},
      ${row.thread_id === undefined ? "thread-1" : row.thread_id},
      ${row.tool_call_id === undefined ? "call-1" : row.tool_call_id},
      ${row.site ?? "mail.google.com"},
      ${row.reason === undefined ? "Read the launch thread." : row.reason},
      ${row.profile_id ?? null},
      ${row.state ?? "asking"},
      ${row.submitting ?? 0},
      ${row.asking_elapsed_ms ?? 0},
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    )
  `;

const insertGrant = (
  sql: SqlClient.SqlClient,
  grantId: string,
  profileId: string,
  botId = "bot-1",
  threadId = "thread-1",
) =>
  sql`
    INSERT INTO projection_browser_session_grants (
      grant_id, profile_id, bot_id, thread_id, site, created_at, last_used_at
    ) VALUES (${grantId}, ${profileId}, ${botId}, ${threadId}, 'mail.google.com',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `;

const refuses = <E>(effect: Effect.Effect<unknown, E, never>) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.isTrue(Exit.isFailure(exit), "expected the statement to be refused");
  });

/** Run an effect against a file-backed database, closing the client when it finishes. */
const withFileDatabase = <A, E>(
  filename: string,
  effect: Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename })), Effect.scoped);

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("081_BrowserAuth", (it) => {
  it.effect("applies to a VACUUM INTO snapshot of a real database and reruns as a no-op", () =>
    Effect.gen(function* () {
      const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "isnadi-browser-auth-"));
      const source = NodePath.join(directory, "source.sqlite");
      const snapshot = NodePath.join(directory, "snapshot.sqlite");

      yield* withFileDatabase(
        source,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* runMigrations({ toMigrationInclusive: 80 });
          yield* sql`
            INSERT INTO projection_work_items (
              work_item_id, group_id, state, done_at, closed_at, record_json
            ) VALUES ('item-1', 'group-1', 'open', NULL, NULL, '{"id":"item-1"}')
          `;
        }),
      );

      const sourceDatabase = new NodeSqlite.DatabaseSync(source, { readOnly: true });
      sourceDatabase.prepare("VACUUM INTO ?").run(snapshot);
      sourceDatabase.close();

      const result = yield* withFileDatabase(
        snapshot,
        Effect.gen(function* () {
          const first = yield* runMigrations();
          const second = yield* runMigrations();
          const sql = yield* SqlClient.SqlClient;

          const [workItems] = yield* sql<{ readonly total: number }>`
            SELECT COUNT(*) AS total FROM projection_work_items
          `;

          const [profiles] = yield* sql<{ readonly total: number }>`
            SELECT COUNT(*) AS total FROM projection_browser_profiles
          `;

          return { first, second, workItems, profiles };
        }),
      );

      assert.deepEqual(result.first, [[81, "BrowserAuth"]]);
      assert.deepEqual(result.second, [], "a second run has nothing left to apply");
      assert.isTrue(migrationManifest.some(([id, name]) => id === 81 && name === "BrowserAuth"));
      assert.equal(result.workItems?.total, 1, "the snapshot's existing rows are untouched");
      assert.equal(result.profiles?.total, 0);

      NodeFS.rmSync(directory, { recursive: true, force: true });
    }),
  );

  it.effect("turns foreign key enforcement on for that connection", () =>
    Effect.gen(function* () {
      const sql = yield* migrateWithForeignKeys;

      const [row] = yield* sql<{ readonly foreign_keys: number }>`PRAGMA foreign_keys`;

      assert.equal(row?.foreign_keys, 1);
    }),
  );

  it.effect("allows one profile row per site, and a tombstone is reused at g+1", () =>
    Effect.gen(function* () {
      const sql = yield* migrateWithForeignKeys;
      yield* insertProfile(sql, "profile-1", "mail.google.com");

      yield* refuses(insertProfile(sql, "profile-2", "mail.google.com"));

      // Sign out keeps the row: the same profile at g+1, signed out.
      yield* sql`
        UPDATE projection_browser_profiles
        SET generation = generation + 1, status = 'signed-out',
            signed_out_at = '2026-01-02T00:00:00.000Z'
        WHERE profile_id = 'profile-1' AND generation = 1
      `;

      // Signing in again reuses it at g+1, guarded by the generation it started from.
      yield* sql`
        UPDATE projection_browser_profiles
        SET generation = generation + 1, status = 'signed-in', signed_out_at = NULL
        WHERE profile_id = 'profile-1' AND generation = 2 AND status = 'signed-out'
      `;

      const rows = yield* sql<{ readonly profile_id: string; readonly generation: number }>`
        SELECT profile_id, generation FROM projection_browser_profiles
      `;

      assert.deepEqual(
        rows.map((row) => ({ ...row })),
        [{ profile_id: "profile-1", generation: 3 }],
      );
    }),
  );

  it.effect("refuses a duplicate grant and a bot request with no tool call", () =>
    Effect.gen(function* () {
      const sql = yield* migrateWithForeignKeys;
      yield* insertProfile(sql, "profile-1", "mail.google.com");
      yield* insertGrant(sql, "grant-1", "profile-1");

      yield* refuses(insertGrant(sql, "grant-2", "profile-1"));
      yield* refuses(insertRequest(sql, { tool_call_id: null }));

      // An owner-started request has no bot and no thread at all.
      yield* insertRequest(sql, {
        request_id: "request-owner",
        requested_by: "owner",
        bot_id: null,
        thread_id: null,
        tool_call_id: null,
        reason: null,
      });
    }),
  );

  it.effect("rejects every unknown value a CHECK guards", () =>
    Effect.gen(function* () {
      const sql = yield* migrateWithForeignKeys;
      yield* insertProfile(sql, "profile-1", "mail.google.com");

      const unknownRequests: ReadonlyArray<RequestRow> = [
        { state: "cancelled" },
        { state: "in_progress" },
        { kind: "sign-out" },
        { requested_by: "system" },
        { submitting: 2 },
        { asking_elapsed_ms: -1 },
        { reason: "x".repeat(501) },
      ];

      for (const [index, row] of unknownRequests.entries()) {
        yield* refuses(insertRequest(sql, { request_id: `request-${index}`, ...row }));
      }

      yield* refuses(
        sql`UPDATE projection_browser_profiles SET route = 'relay' WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(
        sql`UPDATE projection_browser_profiles SET status = 'expired' WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(
        sql`UPDATE projection_browser_profiles SET health = 'healthy' WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(
        sql`UPDATE projection_browser_profiles SET generation = -1 WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(sql`
        UPDATE projection_browser_profiles
        SET auth_hosts = '["a","b","c","d","e","f","g","h","i","j","k"]'
        WHERE profile_id = 'profile-1'
      `);
      yield* refuses(sql`
        UPDATE projection_browser_profiles SET auth_hosts = '{"host":"mail.google.com"}'
        WHERE profile_id = 'profile-1'
      `);
      yield* refuses(sql`
        UPDATE projection_browser_profiles SET auth_hosts = 'mail.google.com'
        WHERE profile_id = 'profile-1'
      `);

      // Ten exact hosts is what the column is for.
      yield* sql`
        UPDATE projection_browser_profiles
        SET auth_hosts = '["a","b","c","d","e","f","g","h","i","j"]'
        WHERE profile_id = 'profile-1'
      `;

      yield* sql`
        INSERT INTO browser_profile_checks (profile_id, result, checked_at)
        VALUES ('profile-1', 'ok', '2026-01-01T00:00:00.000Z')
      `;
      yield* refuses(
        sql`UPDATE browser_profile_checks SET result = 'stale' WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(
        sql`UPDATE browser_profile_checks SET expiry_episode = -1 WHERE profile_id = 'profile-1'`,
      );
      yield* refuses(
        sql`UPDATE browser_profile_checks SET auto_resign_episode = -1 WHERE profile_id = 'profile-1'`,
      );
    }),
  );

  it.effect("cascades a profile delete and nulls the requests that pointed at it", () =>
    Effect.gen(function* () {
      const sql = yield* migrateWithForeignKeys;
      yield* insertProfile(sql, "profile-1", "mail.google.com");
      yield* insertGrant(sql, "grant-1", "profile-1");
      yield* insertRequest(sql, { profile_id: "profile-1" });
      yield* sql`
        INSERT INTO browser_profile_leases (profile_id, holder_id, fencing_token)
        VALUES ('profile-1', 'holder-1', 3)
      `;
      yield* sql`
        INSERT INTO browser_profile_checks (profile_id, result, checked_at)
        VALUES ('profile-1', 'ok', '2026-01-01T00:00:00.000Z')
      `;

      yield* sql`DELETE FROM projection_browser_profiles WHERE profile_id = 'profile-1'`;

      const [counts] = yield* sql<{
        readonly grants: number;
        readonly leases: number;
        readonly checks: number;
      }>`
        SELECT
          (SELECT COUNT(*) FROM projection_browser_session_grants) AS grants,
          (SELECT COUNT(*) FROM browser_profile_leases) AS leases,
          (SELECT COUNT(*) FROM browser_profile_checks) AS checks
      `;

      const [request] = yield* sql<{ readonly profile_id: string | null }>`
        SELECT profile_id FROM projection_browser_auth_requests WHERE request_id = 'request-1'
      `;

      assert.deepEqual({ ...counts }, { grants: 0, leases: 0, checks: 0 });
      assert.isNull(request?.profile_id ?? null, "the request survives without its profile");
    }),
  );
});
