import { assert } from "@effect/vitest";
import { BotId, ThreadId } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { projectionSnapshotLayer } from "./test-support/ProjectionSnapshotHarness.ts";

projectionSnapshotLayer("ProjectionSnapshotQuery lastMessage", (it) => {
  it.effect("a shell carries the chat's newest user or assistant message, never a system one", () =>
    Effect.gen(function* () {
      const snapshotQuery = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`DELETE FROM projection_threads`;
      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, created_at, updated_at, deleted_at
        )
        VALUES (
          'thread-preview', 'project-preview', 'Preview',
          '{"provider":"codex","model":"gpt-5-codex"}', 'full-access', 'default',
          NULL, 0, 0, 0,
          '2026-02-24T00:00:00.000Z', '2026-02-24T00:00:04.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, responding_bot_id,
          is_streaming, created_at, updated_at
        )
        VALUES
          ('message-1', 'thread-preview', NULL, 'user', 'older question', NULL,
           0, '2026-02-24T00:00:01.000Z', '2026-02-24T00:00:01.000Z'),
          ('message-2', 'thread-preview', NULL, 'assistant', 'newest answer', 'bot-layla',
           0, '2026-02-24T00:00:02.000Z', '2026-02-24T00:00:02.000Z'),
          ('message-3', 'thread-preview', NULL, 'system', 'context note', NULL,
           0, '2026-02-24T00:00:03.000Z', '2026-02-24T00:00:03.000Z')
      `;

      const snapshot = yield* snapshotQuery.getShellSnapshot();
      const shell = snapshot.threads.find((thread) => thread.id === "thread-preview");
      const live = yield* snapshotQuery.getThreadShellById(ThreadId.make("thread-preview"));

      assert.deepStrictEqual(shell?.lastMessage, {
        text: "newest answer",
        role: "assistant",
        speakerBotId: BotId.make("bot-layla"),
      });
      assert.deepStrictEqual(
        Option.isSome(live) ? live.value.lastMessage : null,
        shell?.lastMessage,
      );

      yield* sql`DELETE FROM projection_thread_messages`;
      yield* sql`DELETE FROM projection_threads`;
    }),
  );
});
