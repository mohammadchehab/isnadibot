import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

export const BrowserProfileCheckResult = Schema.Literals(["ok", "expired", "unknown"]);

export type BrowserProfileCheckResult = typeof BrowserProfileCheckResult.Type;

/**
 * The outcome of the last health check on one profile. The two episodes are counters the schedule
 * reads: `expiryEpisode` counts expiries without a re-sign-in in between, and `autoResignEpisode`
 * counts automatic re-sign-ins the owner has not seen yet. Nothing here stores a deadline; the
 * next check time is derived from `checkedAt`.
 */
export const BrowserProfileCheck = Schema.Struct({
  profileId: BrowserProfileId,
  result: BrowserProfileCheckResult,
  checkedAt: Schema.String,
  expiryEpisode: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  autoResignEpisode: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type BrowserProfileCheck = typeof BrowserProfileCheck.Type;

export interface BrowserProfileCheckRepositoryShape {
  /** `INSERT … ON CONFLICT`: the latest check wins, per profile. */
  readonly record: (check: BrowserProfileCheck) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly get: (
    profileId: BrowserProfileId,
  ) => Effect.Effect<Option.Option<BrowserProfileCheck>, ProjectionRepositoryError>;
}

export class BrowserProfileCheckRepository extends Context.Service<
  BrowserProfileCheckRepository,
  BrowserProfileCheckRepositoryShape
>()("isnadibot/persistence/Services/BrowserProfileChecks/BrowserProfileCheckRepository") {}
