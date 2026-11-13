import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ProjectionBrowserAuthRequest,
  ProjectionBrowserAuthRequestRepository,
  type ProjectionBrowserAuthRequestRepositoryShape,
} from "../Services/ProjectionBrowserAuthRequests.ts";

const Columns = Schema.Struct({
  requestId: ProjectionBrowserAuthRequest.fields.requestId,
  kind: ProjectionBrowserAuthRequest.fields.kind,
  requestedBy: ProjectionBrowserAuthRequest.fields.requestedBy,
  botId: ProjectionBrowserAuthRequest.fields.botId,
  threadId: ProjectionBrowserAuthRequest.fields.threadId,
  turnId: ProjectionBrowserAuthRequest.fields.turnId,
  toolCallId: ProjectionBrowserAuthRequest.fields.toolCallId,
  groupId: ProjectionBrowserAuthRequest.fields.groupId,
  site: ProjectionBrowserAuthRequest.fields.site,
  startUrl: ProjectionBrowserAuthRequest.fields.startUrl,
  reason: ProjectionBrowserAuthRequest.fields.reason,
  profileId: ProjectionBrowserAuthRequest.fields.profileId,
  state: ProjectionBrowserAuthRequest.fields.state,
  failureClass: ProjectionBrowserAuthRequest.fields.failureClass,
  submitting: ProjectionBrowserAuthRequest.fields.submitting,
  flowId: ProjectionBrowserAuthRequest.fields.flowId,
  startedByClient: ProjectionBrowserAuthRequest.fields.startedByClient,
  askingElapsedMs: ProjectionBrowserAuthRequest.fields.askingElapsedMs,
  askingSince: ProjectionBrowserAuthRequest.fields.askingSince,
  createdAt: ProjectionBrowserAuthRequest.fields.createdAt,
  updatedAt: ProjectionBrowserAuthRequest.fields.updatedAt,
  settledAt: ProjectionBrowserAuthRequest.fields.settledAt,
});

const makeProjectionBrowserAuthRequestRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: Columns,
    execute: (row) => sql`
      INSERT INTO projection_browser_auth_requests (
        request_id, kind, requested_by, bot_id, thread_id, turn_id, tool_call_id, group_id, site,
        start_url, reason, profile_id, state, failure_class, submitting, flow_id,
        started_by_client, asking_elapsed_ms, asking_since, created_at, updated_at, settled_at
      ) VALUES (
        ${row.requestId}, ${row.kind}, ${row.requestedBy}, ${row.botId}, ${row.threadId},
        ${row.turnId}, ${row.toolCallId}, ${row.groupId}, ${row.site}, ${row.startUrl},
        ${row.reason}, ${row.profileId}, ${row.state}, ${row.failureClass}, ${row.submitting},
        ${row.flowId}, ${row.startedByClient}, ${row.askingElapsedMs}, ${row.askingSince},
        ${row.createdAt}, ${row.updatedAt}, ${row.settledAt}
      )
      ON CONFLICT (request_id) DO UPDATE SET
        kind = excluded.kind,
        requested_by = excluded.requested_by,
        bot_id = excluded.bot_id,
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        tool_call_id = excluded.tool_call_id,
        group_id = excluded.group_id,
        site = excluded.site,
        start_url = excluded.start_url,
        reason = excluded.reason,
        profile_id = excluded.profile_id,
        state = excluded.state,
        failure_class = excluded.failure_class,
        submitting = excluded.submitting,
        flow_id = excluded.flow_id,
        started_by_client = excluded.started_by_client,
        asking_elapsed_ms = excluded.asking_elapsed_ms,
        asking_since = excluded.asking_since,
        updated_at = excluded.updated_at,
        settled_at = excluded.settled_at
    `,
  });

  const getByIdRow = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Columns,
    execute: (requestId) => sql`
      SELECT
        request_id AS "requestId", kind, requested_by AS "requestedBy", bot_id AS "botId",
        thread_id AS "threadId", turn_id AS "turnId", tool_call_id AS "toolCallId",
        group_id AS "groupId", site, start_url AS "startUrl", reason, profile_id AS "profileId",
        state, failure_class AS "failureClass", submitting, flow_id AS "flowId",
        started_by_client AS "startedByClient", asking_elapsed_ms AS "askingElapsedMs",
        asking_since AS "askingSince", created_at AS "createdAt", updated_at AS "updatedAt",
        settled_at AS "settledAt"
      FROM projection_browser_auth_requests
      WHERE request_id = ${requestId}
    `,
  });

  const listOpenRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Columns,
    execute: () => sql`
      SELECT
        request_id AS "requestId", kind, requested_by AS "requestedBy", bot_id AS "botId",
        thread_id AS "threadId", turn_id AS "turnId", tool_call_id AS "toolCallId",
        group_id AS "groupId", site, start_url AS "startUrl", reason, profile_id AS "profileId",
        state, failure_class AS "failureClass", submitting, flow_id AS "flowId",
        started_by_client AS "startedByClient", asking_elapsed_ms AS "askingElapsedMs",
        asking_since AS "askingSince", created_at AS "createdAt", updated_at AS "updatedAt",
        settled_at AS "settledAt"
      FROM projection_browser_auth_requests
      WHERE state IN ('asking', 'in-progress')
      ORDER BY created_at ASC, request_id ASC
    `,
  });

  const listByThreadRows = SqlSchema.findAll({
    Request: Schema.String,
    Result: Columns,
    execute: (threadId) => sql`
      SELECT
        request_id AS "requestId", kind, requested_by AS "requestedBy", bot_id AS "botId",
        thread_id AS "threadId", turn_id AS "turnId", tool_call_id AS "toolCallId",
        group_id AS "groupId", site, start_url AS "startUrl", reason, profile_id AS "profileId",
        state, failure_class AS "failureClass", submitting, flow_id AS "flowId",
        started_by_client AS "startedByClient", asking_elapsed_ms AS "askingElapsedMs",
        asking_since AS "askingSince", created_at AS "createdAt", updated_at AS "updatedAt",
        settled_at AS "settledAt"
      FROM projection_browser_auth_requests
      WHERE thread_id = ${threadId}
      ORDER BY created_at ASC, request_id ASC
    `,
  });

  const deleteByThread = (
    threadId: Parameters<ProjectionBrowserAuthRequestRepositoryShape["deleteByThread"]>[0],
  ) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM projection_browser_auth_requests WHERE thread_id = ${threadId}`;
      const [row] = yield* sql<{ readonly changed: number }>`SELECT changes() AS changed`;

      return row?.changed ?? 0;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionBrowserAuthRequestRepository.deleteByThread"),
      ),
    );

  return {
    upsert: (request) =>
      upsertRow(request).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserAuthRequestRepository.upsert")),
      ),
    getById: (requestId) =>
      getByIdRow(requestId).pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserAuthRequestRepository.getById")),
      ),
    listOpen: () =>
      listOpenRows().pipe(
        Effect.mapError(toPersistenceSqlError("ProjectionBrowserAuthRequestRepository.listOpen")),
      ),
    listByThread: (threadId) =>
      listByThreadRows(threadId).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionBrowserAuthRequestRepository.listByThread"),
        ),
      ),
    deleteByThread,
  } satisfies ProjectionBrowserAuthRequestRepositoryShape;
});

export const ProjectionBrowserAuthRequestRepositoryLive = Layer.effect(
  ProjectionBrowserAuthRequestRepository,
  makeProjectionBrowserAuthRequestRepository,
);
