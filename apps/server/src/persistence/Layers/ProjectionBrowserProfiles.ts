import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionBrowserProfile,
  ProjectionBrowserProfileRepository,
  type ProjectionBrowserProfileRepositoryShape,
} from "../Services/ProjectionBrowserProfiles.ts";

const Columns = Schema.Struct({
  profileId: ProjectionBrowserProfile.fields.profileId,
  site: ProjectionBrowserProfile.fields.site,
  label: ProjectionBrowserProfile.fields.label,
  authCheckUrl: ProjectionBrowserProfile.fields.authCheckUrl,
  authHosts: Schema.fromJsonString(Schema.Array(Schema.String)),
  route: ProjectionBrowserProfile.fields.route,
  generation: ProjectionBrowserProfile.fields.generation,
  status: ProjectionBrowserProfile.fields.status,
  health: ProjectionBrowserProfile.fields.health,
  lastWriteId: ProjectionBrowserProfile.fields.lastWriteId,
  createdAt: ProjectionBrowserProfile.fields.createdAt,
  updatedAt: ProjectionBrowserProfile.fields.updatedAt,
  signedOutAt: ProjectionBrowserProfile.fields.signedOutAt,
});

const makeProjectionBrowserProfileRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: Columns,
    execute: (row) => sql`
      INSERT INTO projection_browser_profiles (
        profile_id, site, label, auth_check_url, auth_hosts, route, generation, status, health,
        last_write_id, created_at, updated_at, signed_out_at
      ) VALUES (
        ${row.profileId}, ${row.site}, ${row.label}, ${row.authCheckUrl}, ${row.authHosts},
        ${row.route}, ${row.generation}, ${row.status}, ${row.health}, ${row.lastWriteId},
        ${row.createdAt}, ${row.updatedAt}, ${row.signedOutAt}
      )
      ON CONFLICT (profile_id) DO UPDATE SET
        site = excluded.site,
        label = excluded.label,
        auth_check_url = excluded.auth_check_url,
        auth_hosts = excluded.auth_hosts,
        route = excluded.route,
        generation = excluded.generation,
        status = excluded.status,
        health = excluded.health,
        last_write_id = excluded.last_write_id,
        updated_at = excluded.updated_at,
        signed_out_at = excluded.signed_out_at
    `,
  });

  const getByIdRow = SqlSchema.findOneOption({
    Request: ProjectionBrowserProfile.fields.profileId,
    Result: Columns,
    execute: (profileId) => sql`
      SELECT
        profile_id AS "profileId", site, label, auth_check_url AS "authCheckUrl",
        auth_hosts AS "authHosts", route, generation, status, health,
        last_write_id AS "lastWriteId", created_at AS "createdAt", updated_at AS "updatedAt",
        signed_out_at AS "signedOutAt"
      FROM projection_browser_profiles
      WHERE profile_id = ${profileId}
    `,
  });

  const getBySiteRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Columns,
    execute: (site) => sql`
      SELECT
        profile_id AS "profileId", site, label, auth_check_url AS "authCheckUrl",
        auth_hosts AS "authHosts", route, generation, status, health,
        last_write_id AS "lastWriteId", created_at AS "createdAt", updated_at AS "updatedAt",
        signed_out_at AS "signedOutAt"
      FROM projection_browser_profiles
      WHERE site = ${site}
    `,
  });

  const listLiveRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Columns,
    execute: () => sql`
      SELECT
        profile_id AS "profileId", site, label, auth_check_url AS "authCheckUrl",
        auth_hosts AS "authHosts", route, generation, status, health,
        last_write_id AS "lastWriteId", created_at AS "createdAt", updated_at AS "updatedAt",
        signed_out_at AS "signedOutAt"
      FROM projection_browser_profiles
      WHERE status = 'signed-in'
      ORDER BY site ASC
    `,
  });

  /** The compare-and-set primitive: the update only lands if the row is still at `generation`. */
  const changes = Effect.gen(function* () {
    const [row] = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;

    return (row?.changed ?? 0) > 0;
  });

  const signOut = (input: Parameters<ProjectionBrowserProfileRepositoryShape["signOut"]>[0]) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE projection_browser_profiles
        SET generation = generation + 1,
            status = 'signed-out',
            health = 'unknown',
            signed_out_at = ${input.now},
            updated_at = ${input.now}
        WHERE profile_id = ${input.profileId}
          AND generation = ${input.generation}
          AND status = 'signed-in'
      `;

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.signOut")));

  const signIn = (input: Parameters<ProjectionBrowserProfileRepositoryShape["signIn"]>[0]) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE projection_browser_profiles
        SET generation = generation + 1,
            status = 'signed-in',
            health = 'unknown',
            auth_check_url = COALESCE(${input.authCheckUrl}, auth_check_url),
            last_write_id = COALESCE(${input.lastWriteId}, last_write_id),
            signed_out_at = NULL,
            updated_at = ${input.now}
        WHERE profile_id = ${input.profileId}
          AND generation = ${input.generation}
          AND status = 'signed-out'
      `;

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.signIn")));

  const deleteRow = (profileId: Parameters<ProjectionBrowserProfileRepositoryShape["delete"]>[0]) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_browser_profiles WHERE profile_id = ${profileId}`;

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.delete")));

  return {
    upsert: (profile) =>
      upsertRow(profile).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.upsert")),
      ),
    getById: (profileId) =>
      getByIdRow(profileId).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.getById")),
      ),
    getBySite: (site) =>
      getBySiteRow(site).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.getBySite")),
      ),
    listLive: listLiveRows().pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionBrowserProfileRepository.listLive")),
    ),
    signOut,
    signIn,
    delete: deleteRow,
  } satisfies ProjectionBrowserProfileRepositoryShape;
});

export const ProjectionBrowserProfileRepositoryLive = Layer.effect(
  ProjectionBrowserProfileRepository,
  makeProjectionBrowserProfileRepository,
);
