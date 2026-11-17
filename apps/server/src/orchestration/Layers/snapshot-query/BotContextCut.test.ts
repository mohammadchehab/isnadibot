import { BotId, MessageId, ThreadId } from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../../persistence/NodeSqliteClient.ts";
import { createBotContextCut } from "./BotContextCut.ts";

const THREAD_ID = ThreadId.make("thread-1");

const BOT_ID = BotId.make("bot-isnadi");

const RESET_AT = "2026-08-27T12:00:00.000Z";

const BEFORE_CUT = "2026-08-27T11:00:00.000Z";

const AFTER_CUT = "2026-08-27T13:00:00.000Z";

const NOTE = JSON.stringify({
  botId: BOT_ID,
  doc: { item: "TASK-84", nextStep: "read the note", done: "" },
});

const seed = (input: { readonly groupId: string | null }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({});
    // The layer's in-memory database outlives one test.
    yield* sql`DELETE FROM projection_thread_bot_context`;
    yield* sql`DELETE FROM projection_thread_messages`;
    yield* sql`DELETE FROM projection_thread_activities`;
    yield* sql`DELETE FROM projection_threads`;

    yield* sql`
      INSERT INTO projection_threads (thread_id, project_id, title, group_id, created_at, updated_at)
      VALUES (${THREAD_ID}, 'project-1', 'Chat', ${input.groupId}, ${RESET_AT}, ${RESET_AT})
    `;
    yield* sql`
      INSERT INTO projection_thread_activities (activity_id, thread_id, tone, kind, summary, payload_json, created_at)
      VALUES ('act-1', ${THREAD_ID}, 'info', 'handoff', 'Handed off', ${NOTE}, ${RESET_AT})
    `;
    yield* sql`
      INSERT INTO projection_thread_bot_context (
        thread_id, bot_id, since_sequence, since_message_id, handoff_activity_id, reset_at
      )
      VALUES (${THREAD_ID}, ${BOT_ID}, 3, 'message-3', 'act-1', ${RESET_AT})
    `;
  });

const addReply = (messageId: string, createdAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_thread_messages (
        message_id, thread_id, role, text, is_streaming, created_at, updated_at
      )
      VALUES (${messageId}, ${THREAD_ID}, 'assistant', 'done', 0, ${createdAt}, ${createdAt})
    `;
  });

const readCut = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return createBotContextCut({ sql }).getBotContextCut({ threadId: THREAD_ID, botId: BOT_ID });
}).pipe(Effect.flatten);

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("bot context cut", (it) => {
  it.effect("a direct chat spends the note once the bot replies after the cut", () =>
    Effect.gen(function* () {
      yield* seed({ groupId: null });

      const cut = Option.getOrThrow(yield* readCut);
      assert.strictEqual(cut.sinceMessageId, MessageId.make("message-3"));
      assert.isFalse(cut.docSpent);

      // A reply written before the cut says nothing about the note.
      yield* addReply("message-2", BEFORE_CUT);
      assert.isFalse(Option.getOrThrow(yield* readCut).docSpent);

      yield* addReply("message-4", AFTER_CUT);
      assert.isTrue(Option.getOrThrow(yield* readCut).docSpent);
    }),
  );

  it.effect("a group chat keeps the note, because no row says which member replied", () =>
    Effect.gen(function* () {
      yield* seed({ groupId: "group-1" });
      yield* addReply("message-4", AFTER_CUT);

      const cut = Option.getOrThrow(yield* readCut);

      assert.isFalse(cut.docSpent);
      assert.deepEqual(cut.handoffDoc?.item, "TASK-84");
    }),
  );
});
