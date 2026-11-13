import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  BrowserProfileLease,
  BrowserProfileLeaseRepository,
  type BrowserProfileLeaseRepositoryShape,
} from "../Services/BrowserProfileLeases.ts";

const Columns = Schema.Struct({
  profileId: BrowserProfileLease.fields.profileId,
  holderId: BrowserProfileLease.fields.holderId,
  fencingToken: BrowserProfileLease.fields.fencingToken,
  heartbeatAt: BrowserProfileLease.fields.heartbeatAt,
  expiresAt: BrowserProfileLease.fields.expiresAt,
});

const makeBrowserProfileLeaseRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readLease = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Columns,
    execute: (profileId) => sql`
      SELECT
        profile_id AS "profileId", holder_id AS "holderId", fencing_token AS "fencingToken",
        heartbeat_at AS "heartbeatAt", expires_at AS "expiresAt"
      FROM browser_profile_leases
      WHERE profile_id = ${profileId}
    `,
  });

  /** The compare-and-set primitive: true when the statement it follows touched the row. */
  const changes = Effect.gen(function* () {
    const [row] = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;

    return (row?.changed ?? 0) > 0;
  });

  const acquire = (hold: Parameters<BrowserProfileLeaseRepositoryShape["acquire"]>[0]) =>
    Effect.gen(function* () {
      // A free row, or one whose TTL has passed, is taken over at `fencing_token + 1`. The
      // `WHERE` makes that the compare-and-set: while a holder is live, nothing changes.
      yield* sql`
        INSERT INTO browser_profile_leases (
          profile_id, holder_id, fencing_token, heartbeat_at, expires_at
        ) VALUES (${hold.profileId}, ${hold.holderId}, 1, ${hold.now}, ${hold.expiresAt})
        ON CONFLICT (profile_id) DO UPDATE SET
          holder_id = excluded.holder_id,
          fencing_token = browser_profile_leases.fencing_token + 1,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at
        WHERE browser_profile_leases.holder_id IS NULL
          OR browser_profile_leases.expires_at IS NULL
          OR browser_profile_leases.expires_at <= ${hold.now}
      `;

      // Reading our own id back is the only proof: a refused takeover leaves the other holder in.
      const lease = yield* readLease(hold.profileId);

      return Option.filter(lease, (row) => row.holderId === hold.holderId);
    }).pipe(Effect.mapError(toPersistenceSqlError("BrowserProfileLeaseRepository.acquire")));

  const renew = (hold: Parameters<BrowserProfileLeaseRepositoryShape["renew"]>[0]) =>
    Effect.gen(function* () {
      yield* sql`
        UPDATE browser_profile_leases
        SET heartbeat_at = ${hold.now}, expires_at = ${hold.expiresAt}
        WHERE profile_id = ${hold.profileId}
          AND holder_id = ${hold.holderId}
          AND fencing_token = ${hold.fencingToken}
      `;

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError("BrowserProfileLeaseRepository.renew")));

  const release = (input: Parameters<BrowserProfileLeaseRepositoryShape["release"]>[0]) =>
    Effect.gen(function* () {
      // The holder and the TTL go; the row and its token stay, so the next takeover is higher.
      yield* sql`
        UPDATE browser_profile_leases
        SET holder_id = NULL, heartbeat_at = NULL, expires_at = NULL
        WHERE profile_id = ${input.profileId}
          AND holder_id = ${input.holderId}
          AND fencing_token = ${input.fencingToken}
      `;

      return yield* changes;
    }).pipe(Effect.mapError(toPersistenceSqlError("BrowserProfileLeaseRepository.release")));

  return {
    acquire,
    renew,
    release,
    get: (profileId: Parameters<BrowserProfileLeaseRepositoryShape["get"]>[0]) =>
      readLease(profileId).pipe(
        Effect.mapError(toPersistenceSqlError("BrowserProfileLeaseRepository.get")),
      ),
  } satisfies BrowserProfileLeaseRepositoryShape;
});

export const BrowserProfileLeaseRepositoryLive = Layer.effect(
  BrowserProfileLeaseRepository,
  makeBrowserProfileLeaseRepository,
);
