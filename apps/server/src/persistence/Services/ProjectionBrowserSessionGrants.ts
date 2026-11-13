import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

/**
 * A grant says one bot may use one profile inside one thread. Expiry is derived from
 * `lastUsedAt` (30 days), so nothing here stores a deadline. There is no foreign key to a bot or
 * a thread: the projector deletes grants on sign-out, bot archive, bot delete, the bot leaving the
 * group, and thread delete.
 */
export const ProjectionBrowserSessionGrant = Schema.Struct({
  grantId: Schema.String,
  profileId: BrowserProfileId,
  botId: Schema.String,
  threadId: Schema.String,
  site: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.String,
});

export type ProjectionBrowserSessionGrant = typeof ProjectionBrowserSessionGrant.Type;

export interface ProjectionBrowserSessionGrantRepositoryShape {
  /** `UNIQUE(profile_id, bot_id, thread_id)`: a repeated approval refreshes, it never stacks. */
  readonly upsert: (
    grant: ProjectionBrowserSessionGrant,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly listForBotThread: (input: {
    readonly botId: string;
    readonly threadId: string;
  }) => Effect.Effect<ReadonlyArray<ProjectionBrowserSessionGrant>, ProjectionRepositoryError>;
  /** A handle use refreshes the 30-day clock. */
  readonly touch: (input: {
    readonly grantId: string;
    readonly now: string;
  }) => Effect.Effect<boolean, ProjectionRepositoryError>;
  readonly deleteByBot: (botId: string) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly deleteByThread: (threadId: string) => Effect.Effect<number, ProjectionRepositoryError>;
  readonly deleteByProfile: (
    profileId: BrowserProfileId,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
  /** Grants not used since `before` are expired by derivation; the sweep removes them. */
  readonly deleteExpired: (before: string) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class ProjectionBrowserSessionGrantRepository extends Context.Service<
  ProjectionBrowserSessionGrantRepository,
  ProjectionBrowserSessionGrantRepositoryShape
>()(
  "isnadibot/persistence/Services/ProjectionBrowserSessionGrants/ProjectionBrowserSessionGrantRepository",
) {}
