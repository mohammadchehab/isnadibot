import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";
import { BrowserProfileId } from "../../browserAuth/profileId.ts";

export const BrowserAuthRequestKind = Schema.Literals(["sign-in", "access"]);

export type BrowserAuthRequestKind = typeof BrowserAuthRequestKind.Type;

export const BrowserAuthRequestedBy = Schema.Literals(["bot", "owner"]);

export type BrowserAuthRequestedBy = typeof BrowserAuthRequestedBy.Type;

/** There is no `cancelled`: Cancel returns a bot's request to `asking`. */
export const BrowserAuthRequestState = Schema.Literals([
  "asking",
  "in-progress",
  "signed-in",
  "failed",
  "dismissed",
  "expired",
]);

export type BrowserAuthRequestState = typeof BrowserAuthRequestState.Type;

/**
 * The durable thing a bot asks for and the owner answers. It is metadata only: site, state and
 * timestamps. The typed values a sign-in form takes never reach a row, and the 10-minute wait is
 * derived from `askingElapsedMs` plus `askingSince` rather than stored as a deadline.
 */
export const ProjectionBrowserAuthRequest = Schema.Struct({
  requestId: Schema.String,
  kind: BrowserAuthRequestKind,
  requestedBy: BrowserAuthRequestedBy,
  botId: Schema.NullOr(Schema.String),
  threadId: Schema.NullOr(Schema.String),
  turnId: Schema.NullOr(Schema.String),
  toolCallId: Schema.NullOr(Schema.String),
  groupId: Schema.NullOr(Schema.String),
  site: Schema.String,
  startUrl: Schema.NullOr(Schema.String),
  reason: Schema.NullOr(Schema.String),
  profileId: Schema.NullOr(BrowserProfileId),
  state: BrowserAuthRequestState,
  failureClass: Schema.NullOr(Schema.String),
  submitting: Schema.BooleanFromBit,
  flowId: Schema.NullOr(Schema.String),
  startedByClient: Schema.NullOr(Schema.String),
  askingElapsedMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  askingSince: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  settledAt: Schema.NullOr(Schema.String),
});

export type ProjectionBrowserAuthRequest = typeof ProjectionBrowserAuthRequest.Type;

export interface ProjectionBrowserAuthRequestRepositoryShape {
  readonly upsert: (
    request: ProjectionBrowserAuthRequest,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    requestId: string,
  ) => Effect.Effect<Option.Option<ProjectionBrowserAuthRequest>, ProjectionRepositoryError>;
  /** Every request still waiting on the owner, oldest first. */
  readonly listOpen: () => Effect.Effect<
    ReadonlyArray<ProjectionBrowserAuthRequest>,
    ProjectionRepositoryError
  >;
  readonly listByThread: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<ProjectionBrowserAuthRequest>, ProjectionRepositoryError>;
  /** Turn end, interrupt and thread delete all end a thread's requests the same way. */
  readonly deleteByThread: (threadId: string) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class ProjectionBrowserAuthRequestRepository extends Context.Service<
  ProjectionBrowserAuthRequestRepository,
  ProjectionBrowserAuthRequestRepositoryShape
>()(
  "isnadibot/persistence/Services/ProjectionBrowserAuthRequests/ProjectionBrowserAuthRequestRepository",
) {}
