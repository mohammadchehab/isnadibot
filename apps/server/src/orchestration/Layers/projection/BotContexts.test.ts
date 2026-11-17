import {
  BotId,
  CommandId,
  CorrelationId,
  EventId,
  MessageId,
  ThreadId,
  type OrchestrationEvent,
} from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { createBotContexts } from "./BotContexts.ts";

const NOW = "2026-08-27T12:00:00.000Z";

const THREAD_ID = ThreadId.make("thread-direct");

const BOT_ID = BotId.make("bot-isnadi");

const OTHER_BOT_ID = BotId.make("bot-other");

interface Row {
  readonly sinceSequence: number;
  readonly sinceMessageId: string;
  readonly handoffActivityId: string | null;
  readonly previousSinceSequence: number | null;
  readonly previousSinceMessageId: string | null;
}

const eventBase = (sequence: number, eventId: string) => ({
  sequence,
  eventId: EventId.make(eventId),
  aggregateKind: "thread" as const,
  aggregateId: THREAD_ID,
  occurredAt: NOW,
  commandId: CommandId.make(`cmd-${eventId}`),
  causationEventId: null,
  correlationId: CorrelationId.make(`cmd-${eventId}`),
  metadata: {},
});

const resetEvent = (input: {
  readonly sequence: number;
  readonly eventId: string;
  readonly cut: { readonly sequence: number; readonly messageId: string };
  readonly handoffActivityId?: EventId;
  readonly botId?: BotId;
}): OrchestrationEvent => ({
  ...eventBase(input.sequence, input.eventId),
  type: "thread.context-reset",
  payload: {
    threadId: THREAD_ID,
    botId: input.botId ?? BOT_ID,
    sinceMessageId: MessageId.make(input.cut.messageId),
    sinceSequence: input.cut.sequence,
    handoffActivityId: input.handoffActivityId ?? null,
    resetAt: NOW,
  },
});

const undoEvent = (input: {
  readonly sequence: number;
  readonly eventId: string;
  readonly botId?: BotId;
}): OrchestrationEvent => ({
  ...eventBase(input.sequence, input.eventId),
  type: "thread.context-reset-undone",
  payload: { threadId: THREAD_ID, botId: input.botId ?? BOT_ID, undoneAt: NOW },
});

const deleteEvent = (input: { readonly sequence: number; readonly eventId: string }) => ({
  ...eventBase(input.sequence, input.eventId),
  type: "thread.deleted" as const,
  payload: { threadId: THREAD_ID, deletedAt: NOW },
});

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("bot contexts projection", (it) => {
  const applyAll = (events: ReadonlyArray<OrchestrationEvent>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({});
      // The layer's in-memory database outlives one test, so each test starts
      // from an empty table rather than from the rows the one before it wrote.
      yield* sql`DELETE FROM projection_thread_bot_context`;
      const { applyBotContextsProjection } = createBotContexts({ sql });

      const sideEffects = {
        deletedThreadIds: new Set<string>(),
        prunedThreadRelativePaths: new Map<string, Set<string>>(),
      };

      yield* Effect.forEach(events, (event) => applyBotContextsProjection(event, sideEffects), {
        discard: true,
      });

      return yield* sql<Row>`
        SELECT
          since_sequence AS "sinceSequence",
          since_message_id AS "sinceMessageId",
          handoff_activity_id AS "handoffActivityId",
          previous_since_sequence AS "previousSinceSequence",
          previous_since_message_id AS "previousSinceMessageId"
        FROM projection_thread_bot_context
        ORDER BY bot_id
      `;
    });

  it.effect("records the cut and the note a reset names", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset",
          cut: { sequence: 3, messageId: "message-3" },
          handoffActivityId: EventId.make("act-1"),
        }),
      ]);

      assert.deepEqual(rows, [
        {
          sinceSequence: 3,
          sinceMessageId: "message-3",
          handoffActivityId: "act-1",
          previousSinceSequence: null,
          previousSinceMessageId: null,
        },
      ]);
    }),
  );

  it.effect("keeps the cut a second reset replaced, so undo can restore it", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset-1",
          cut: { sequence: 3, messageId: "message-3" },
        }),
        resetEvent({
          sequence: 2,
          eventId: "evt-reset-2",
          cut: { sequence: 7, messageId: "message-7" },
        }),
      ]);

      assert.deepEqual(rows, [
        {
          sinceSequence: 7,
          sinceMessageId: "message-7",
          handoffActivityId: null,
          previousSinceSequence: 3,
          previousSinceMessageId: "message-3",
        },
      ]);
    }),
  );

  it.effect("undo restores the replaced cut and drops the note", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset-1",
          cut: { sequence: 3, messageId: "message-3" },
        }),
        resetEvent({
          sequence: 2,
          eventId: "evt-reset-2",
          cut: { sequence: 7, messageId: "message-7" },
          handoffActivityId: EventId.make("act-2"),
        }),
        undoEvent({ sequence: 3, eventId: "evt-undo" }),
      ]);

      assert.deepEqual(rows, [
        {
          sinceSequence: 3,
          sinceMessageId: "message-3",
          handoffActivityId: null,
          previousSinceSequence: null,
          previousSinceMessageId: null,
        },
      ]);
    }),
  );

  it.effect("undo of a bot's first reset leaves it reading the whole chat", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset",
          cut: { sequence: 3, messageId: "message-3" },
        }),
        undoEvent({ sequence: 2, eventId: "evt-undo" }),
      ]);

      assert.deepEqual(rows, []);
    }),
  );

  it.effect("one bot's reset leaves another bot's cut alone", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset-other",
          cut: { sequence: 2, messageId: "message-2" },
          botId: OTHER_BOT_ID,
        }),
        resetEvent({
          sequence: 2,
          eventId: "evt-reset",
          cut: { sequence: 5, messageId: "message-5" },
        }),
      ]);

      assert.deepEqual(
        rows.map((row) => row.sinceSequence),
        [5, 2],
      );
    }),
  );

  it.effect("a deleted chat drops its cuts", () =>
    Effect.gen(function* () {
      const rows = yield* applyAll([
        resetEvent({
          sequence: 1,
          eventId: "evt-reset",
          cut: { sequence: 3, messageId: "message-3" },
        }),
        deleteEvent({ sequence: 2, eventId: "evt-deleted" }),
      ]);

      assert.deepEqual(rows, []);
    }),
  );
});
