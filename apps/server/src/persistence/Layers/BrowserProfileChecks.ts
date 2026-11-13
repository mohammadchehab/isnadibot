import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  BrowserProfileCheck,
  BrowserProfileCheckRepository,
  type BrowserProfileCheckRepositoryShape,
} from "../Services/BrowserProfileChecks.ts";

const Columns = Schema.Struct({
  profileId: BrowserProfileCheck.fields.profileId,
  result: BrowserProfileCheck.fields.result,
  checkedAt: BrowserProfileCheck.fields.checkedAt,
  expiryEpisode: BrowserProfileCheck.fields.expiryEpisode,
  autoResignEpisode: BrowserProfileCheck.fields.autoResignEpisode,
});

const makeBrowserProfileCheckRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const recordRow = SqlSchema.void({
    Request: Columns,
    execute: (row) => sql`
      INSERT INTO browser_profile_checks (
        profile_id, result, checked_at, expiry_episode, auto_resign_episode
      ) VALUES (
        ${row.profileId}, ${row.result}, ${row.checkedAt}, ${row.expiryEpisode},
        ${row.autoResignEpisode}
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        result = excluded.result,
        checked_at = excluded.checked_at,
        expiry_episode = excluded.expiry_episode,
        auto_resign_episode = excluded.auto_resign_episode
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Columns,
    execute: (profileId) => sql`
      SELECT
        profile_id AS "profileId", result, checked_at AS "checkedAt",
        expiry_episode AS "expiryEpisode", auto_resign_episode AS "autoResignEpisode"
      FROM browser_profile_checks
      WHERE profile_id = ${profileId}
    `,
  });

  return {
    record: recordRow.pipe(
      Effect.mapError(toPersistenceSqlError("BrowserProfileCheckRepository.record")),
    ),
    get: (profileId: Parameters<BrowserProfileCheckRepositoryShape["get"]>[0]) =>
      getRow(profileId).pipe(
        Effect.mapError(toPersistenceSqlError("BrowserProfileCheckRepository.get")),
      ),
  } satisfies BrowserProfileCheckRepositoryShape;
});

export const BrowserProfileCheckRepositoryLive = Layer.effect(
  BrowserProfileCheckRepository,
  makeBrowserProfileCheckRepository,
);
