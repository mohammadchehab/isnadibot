/**
 * ProjectionThreadSessionRepository - Repository interface for thread sessions.
 *
 * Owns persistence operations for projected provider-session linkage and
 * runtime status for each thread.
 *
 * @module ProjectionThreadSessionRepository
 */
import {
  RuntimeMode,
  IsoDateTime,
  McpServerId,
  OrchestrationSessionStatus,
  ProviderInstanceId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "@isnadi/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionThreadSession = Schema.Struct({
  threadId: ThreadId,
  status: OrchestrationSessionStatus,
  providerName: Schema.NullOr(Schema.String),
  providerInstanceId: Schema.NullOr(ProviderInstanceId),
  runtimeMode: RuntimeMode,
  mcpServerIds: Schema.Array(McpServerId),
  activeTurnId: Schema.NullOr(TurnId),
  lastError: Schema.NullOr(Schema.String),
  // Why the session cannot be used right now, so a reload still shows a sign-in problem. Null for
  // sessions that were written before this was tracked. Stored as the string the event carried, not
  // the closed union: an event written by a newer server names a reason this one does not know, and
  // the row must keep it so the client can show it or fall back, rather than lose it here.
  unavailability: Schema.NullOr(TrimmedNonEmptyString),
  updatedAt: IsoDateTime,
});

export type ProjectionThreadSession = typeof ProjectionThreadSession.Type;

export const GetProjectionThreadSessionInput = Schema.Struct({
  threadId: ThreadId,
});

export type GetProjectionThreadSessionInput = typeof GetProjectionThreadSessionInput.Type;

export const DeleteProjectionThreadSessionInput = Schema.Struct({
  threadId: ThreadId,
});

export type DeleteProjectionThreadSessionInput = typeof DeleteProjectionThreadSessionInput.Type;

/**
 * ProjectionThreadSessionRepositoryShape - Service API for projected thread sessions.
 */
export interface ProjectionThreadSessionRepositoryShape {
  /**
   * Insert or replace a projected thread-session row.
   *
   * Upserts by `threadId`.
   */
  readonly upsert: (row: ProjectionThreadSession) => Effect.Effect<void, ProjectionRepositoryError>;

  /**
   * Read projected thread-session state by thread id.
   */
  readonly getByThreadId: (
    input: GetProjectionThreadSessionInput,
  ) => Effect.Effect<Option.Option<ProjectionThreadSession>, ProjectionRepositoryError>;

  /**
   * Delete projected thread-session state by thread id.
   */
  readonly deleteByThreadId: (
    input: DeleteProjectionThreadSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ProjectionThreadSessionRepository - Service tag for thread-session persistence.
 */
export class ProjectionThreadSessionRepository extends Context.Service<
  ProjectionThreadSessionRepository,
  ProjectionThreadSessionRepositoryShape
>()("isnadibot/persistence/Services/ProjectionThreadSessions/ProjectionThreadSessionRepository") {}
