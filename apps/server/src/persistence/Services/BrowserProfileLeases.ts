import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

/**
 * One writer at a time per profile: a lease with a 30 s TTL, a 10 s heartbeat, and a fencing
 * token that only ever grows. The row outlives a release, so a holder that comes back after
 * losing the lease is refused by its token rather than by the row being gone.
 */
export const BrowserProfileLease = Schema.Struct({
  profileId: BrowserProfileId,
  holderId: Schema.NullOr(Schema.String),
  fencingToken: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  heartbeatAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
});

export type BrowserProfileLease = typeof BrowserProfileLease.Type;

export const BrowserProfileLeaseHold = Schema.Struct({
  profileId: BrowserProfileId,
  holderId: Schema.String,
  fencingToken: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  now: Schema.String,
  expiresAt: Schema.String,
});

export type BrowserProfileLeaseHold = typeof BrowserProfileLeaseHold.Type;

export interface BrowserProfileLeaseRepositoryShape {
  /**
   * Take the lease when it is free or its expiry has passed. The token grows by one on every
   * takeover, and `Option.none` means another holder still has it.
   */
  readonly acquire: (
    hold: BrowserProfileLeaseHold,
  ) => Effect.Effect<Option.Option<BrowserProfileLease>, ProjectionRepositoryError>;
  /** Extend the lease while this holder still owns `fencingToken`; false means it was fenced. */
  readonly renew: (
    hold: BrowserProfileLeaseHold,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  /** Give the lease up; the row and its token stay, so the next takeover has a higher one. */
  readonly release: (input: {
    readonly profileId: BrowserProfileId;
    readonly holderId: string;
    readonly fencingToken: number;
  }) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly get: (
    profileId: BrowserProfileId,
  ) => Effect.Effect<Option.Option<BrowserProfileLease>, ProjectionRepositoryError>;
}

export class BrowserProfileLeaseRepository extends Context.Service<
  BrowserProfileLeaseRepository,
  BrowserProfileLeaseRepositoryShape
>()("isnadibot/persistence/Services/BrowserProfileLeases/BrowserProfileLeaseRepository") {}
