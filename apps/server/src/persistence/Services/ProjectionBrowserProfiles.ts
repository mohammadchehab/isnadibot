import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

export const BrowserProfileRoute = Schema.Literals(["direct", "pc"]);

export type BrowserProfileRoute = typeof BrowserProfileRoute.Type;

export const BrowserProfileStatus = Schema.Literals(["signed-in", "signed-out"]);

export type BrowserProfileStatus = typeof BrowserProfileStatus.Type;

export const BrowserProfileHealth = Schema.Literals(["ok", "expired", "unknown"]);

export type BrowserProfileHealth = typeof BrowserProfileHealth.Type;

/**
 * One row per site, reused on re-sign-in. The row never holds ciphertext: `generation` names the
 * file under `<stateDir>/browser-profiles`, and a sign-out is the same row at `generation + 1`
 * with `status` flipped, so a write that started at an older generation is refused.
 */
export const ProjectionBrowserProfile = Schema.Struct({
  profileId: BrowserProfileId,
  site: Schema.String,
  label: Schema.NullOr(Schema.String),
  authCheckUrl: Schema.NullOr(Schema.String),
  authHosts: Schema.Array(Schema.String),
  route: BrowserProfileRoute,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  status: BrowserProfileStatus,
  health: BrowserProfileHealth,
  lastWriteId: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  signedOutAt: Schema.NullOr(Schema.String),
});

export type ProjectionBrowserProfile = typeof ProjectionBrowserProfile.Type;

/** The row a save, a sign-out or a health check writes from: everything is guarded by it. */
export const BrowserProfileGenerationInput = Schema.Struct({
  profileId: BrowserProfileId,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  now: Schema.String,
});

export type BrowserProfileGenerationInput = typeof BrowserProfileGenerationInput.Type;

export const BrowserProfileSignInInput = Schema.Struct({
  profileId: BrowserProfileId,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  authCheckUrl: Schema.NullOr(Schema.String),
  lastWriteId: Schema.NullOr(Schema.String),
  now: Schema.String,
});

export type BrowserProfileSignInInput = typeof BrowserProfileSignInInput.Type;

export interface ProjectionBrowserProfileRepositoryShape {
  /** Insert or replace the whole row. The caller owns the generation compare-and-set. */
  readonly upsert: (
    profile: ProjectionBrowserProfile,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    profileId: BrowserProfileId,
  ) => Effect.Effect<Option.Option<ProjectionBrowserProfile>, ProjectionRepositoryError>;
  readonly getBySite: (
    site: string,
  ) => Effect.Effect<Option.Option<ProjectionBrowserProfile>, ProjectionRepositoryError>;
  /** Signed-in profiles only, by site; tombstones stay out of the list the owner sees. */
  readonly listLive: () => Effect.Effect<
    ReadonlyArray<ProjectionBrowserProfile>,
    ProjectionRepositoryError
  >;
  /** Sign out: the same row becomes a tombstone at `generation + 1`. */
  readonly signOut: (
    input: BrowserProfileGenerationInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  /** Sign in again from a tombstone, at `generation + 1`, on the same `profileId`. */
  readonly signIn: (
    input: BrowserProfileSignInInput,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly delete: (
    profileId: BrowserProfileId,
  ) => Effect.Effect<boolean, ProjectionRepositoryError>;
}

export class ProjectionBrowserProfileRepository extends Context.Service<
  ProjectionBrowserProfileRepository,
  ProjectionBrowserProfileRepositoryShape
>()(
  "isnadibot/persistence/Services/ProjectionBrowserProfiles/ProjectionBrowserProfileRepository",
) {}
