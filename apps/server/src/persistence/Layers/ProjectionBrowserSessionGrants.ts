import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionBrowserSessionGrant,
  ProjectionBrowserSessionGrantRepository,
  type ProjectionBrowserSessionGrantRepositoryShape,
} from "../Services/ProjectionBrowserSessionGrants.ts";

const Columns = Schema.Struct({
  grantId: ProjectionBrowserSessionGrant.fields.grantId,
  profileId: ProjectionBrowserSessionGrant.fields.profileId,
  botId: ProjectionBrowserSessionGrant.fields.botId,
  threadId: ProjectionBrowserSessionGrant.fields.threadId,
  site: ProjectionBrowserSessionGrant.fields.site,
  createdAt: ProjectionBrowserSessionGrant.fields.createdAt,
  lastUsedAt: ProjectionBrowserSessionGrant.fields.lastUsedAt,
});

const makeProjectionBrowserSessionGrantRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: Columns,
    execute: (row) => sql`
      INSERT INTO projection_browser_session_grants (
        grant_id, profile_id, bot_id, thread_id, site, created_at, last_used_at
      ) VALUES (
        ${row.grantId}, ${row.profileId}, ${row.botId}, ${row.threadId}, ${row.site},
        ${row.createdAt}, ${row.lastUsedAt}
      )
      ON CONFLICT (profile_id, bot_id, thread_id) DO UPDATE SET
        site = excluded.site,
        last_used_at = excluded.last_used_at
    `,
  });

  const listForBotThreadRows = SqlSchema.findAll({
    Request: Schema.Struct({ botId: Schema.String, threadId: Schema.String }),
    Result: Columns,
    execute: ({ botId, threadId }) => sql`
      SELECT
        grant_id AS "grantId", profile_id AS "profileId", bot_id AS "botId",
        thread_id AS "threadId", site, created_at AS "createdAt", last_used_at AS "lastUsedAt"
      FROM projection_browser_session_grants
      WHERE bot_id = ${botId} AND thread_id = ${threadId}
      ORDER BY site ASC, grant_id ASC
    `,
  });

  const changes = Effect.gen(function* () {
    const [row] = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;

    return row?.changed ?? 0;
  });

  const touch = (input: Parameters<ProjectionBrowserSessionGrantRepositoryShape["touch"]>[0]) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE projection_browser_session_grants
        SET last_used_at = ${input.now}
        WHERE grant_id = ${input.grantId}
      `;

      return (yield* changes) > 0;
    }).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBrowserSessionGrantRepository.touch")),
    );

  const deleteMatching = (operation: string, run: () => Effect.Effect<unknown, unknown>) =>
    Effect.gen(function* () {
      yield* run();

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError(operation)));

  const deleteByBot = (
    botId: Parameters<ProjectionBrowserSessionGrantRepositoryShape["deleteByBot"]>[0],
  ) =>
    deleteMatching(
      "ProjectionBrowserSessionGrantRepository.deleteByBot",
      () => sql`DELETE FROM projection_browser_session_grants WHERE bot_id = ${botId}`,
    );

  const deleteByThread = (
    threadId: Parameters<ProjectionBrowserSessionGrantRepositoryShape["deleteByThread"]>[0],
  ) =>
    deleteMatching(
      "ProjectionBrowserSessionGrantRepository.deleteByThread",
      () => sql`DELETE FROM projection_browser_session_grants WHERE thread_id = ${threadId}`,
    );

  const deleteByProfile = (
    profileId: Parameters<ProjectionBrowserSessionGrantRepositoryShape["deleteByProfile"]>[0],
  ) =>
    deleteMatching(
      "ProjectionBrowserSessionGrantRepository.deleteByProfile",
      () => sql`DELETE FROM projection_browser_session_grants WHERE profile_id = ${profileId}`,
    );

  const deleteExpired = (
    before: Parameters<ProjectionBrowserSessionGrantRepositoryShape["deleteExpired"]>[0],
  ) =>
    deleteMatching(
      "ProjectionBrowserSessionGrantRepository.deleteExpired",
      () => sql`DELETE FROM projection_browser_session_grants WHERE last_used_at < ${before}`,
    );

  return {
    upsert: (grant) =>
      upsertRow(grant).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserSessionGrantRepository.upsert")),
      ),
    listForBotThread: (input) =>
      listForBotThreadRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionBrowserSessionGrantRepository.listForBotThread"),
        ),
      ),
    touch,
    deleteByBot,
    deleteByThread,
    deleteByProfile,
    deleteExpired,
  } satisfies ProjectionBrowserSessionGrantRepositoryShape;
});

export const ProjectionBrowserSessionGrantRepositoryLive = Layer.effect(
  ProjectionBrowserSessionGrantRepository,
  makeProjectionBrowserSessionGrantRepository,
);
