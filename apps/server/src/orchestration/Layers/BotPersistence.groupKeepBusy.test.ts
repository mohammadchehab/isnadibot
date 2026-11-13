import { BotId, CommandId, GroupId } from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { OrchestrationProjectionPipeline } from "../Services/ProjectionPipeline.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TestLayer } from "./test-support/BotPersistenceHarness.ts";

it.layer(TestLayer)("group keep busy persistence", (it) => {
  it.effect("round-trips the keep-busy flag through the projection and the snapshot", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const pipeline = yield* OrchestrationProjectionPipeline;
      const snapshots = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const botId = BotId.make("bot-1");
      const createdAt = "2026-01-01T00:00:00.000Z";

      for (const [id, name] of [
        ["bot-1", "Scout"],
        ["bot-2", "Scribe"],
      ] as const) {
        yield* engine.dispatch({
          type: "bot.create",
          commandId: CommandId.make(`cmd-${id}`),
          botId: BotId.make(id),
          name,
          title: "Research lead",
          label: "Research",
          description: "Finds evidence.",
          avatar: { kind: "dither", seed: id },
          engine: null,
          sandbox: "local",
          runtimeMode: "full-access",
          groupId: null,
          createdAt,
        });
      }

      for (const [id, keepBusy] of [
        ["keep-busy", true],
        ["stays-idle", undefined],
      ] as const) {
        yield* engine.dispatch({
          type: "group.create",
          commandId: CommandId.make(`cmd-${id}`),
          groupId: GroupId.make(id),
          name: id,
          bossBotId: botId,
          specialistBotIds: [BotId.make("bot-2")],
          ...(keepBusy === undefined ? {} : { keepBusy }),
          createdAt,
        });
      }

      const columns = yield* sql<{ readonly id: string; readonly keepBusy: number }>`
        SELECT group_id AS "id", keep_busy AS "keepBusy" FROM projection_groups ORDER BY group_id
      `;

      assert.deepEqual(columns, [
        { id: "keep-busy", keepBusy: 1 },
        { id: "stays-idle", keepBusy: 0 },
      ]);

      const check = (
        groups: ReadonlyArray<{ readonly id: string; readonly keepBusy?: boolean | undefined }>,
      ) => {
        assert.isTrue(groups.find((group) => group.id === "keep-busy")?.keepBusy);
        assert.isFalse(groups.find((group) => group.id === "stays-idle")?.keepBusy);
      };

      check((yield* snapshots.getShellSnapshot()).groups);

      yield* sql`DELETE FROM projection_groups`;
      yield* sql`DELETE FROM projection_state WHERE projector = 'projection.groups'`;
      yield* pipeline.bootstrap;
      check((yield* snapshots.getSnapshot()).groups);
    }),
  );
});
