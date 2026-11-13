import { BotId, CommandId, GroupId, WORK_ITEM_PREVIEW_LIMIT, WorkItemId } from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionWorkItemRepositoryLive } from "../../persistence/Layers/ProjectionWorkItems.ts";
import { ProjectionWorkItemRepository } from "../../persistence/Services/ProjectionWorkItems.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { TestLayer } from "./test-support/BotPersistenceHarness.ts";

/** The shared in-memory database plus the id-based work item read the shell leaves to `workItems.get`. */
const TestLayerWithWorkItemReads = ProjectionWorkItemRepositoryLive.pipe(
  Layer.provideMerge(TestLayer),
);

const BOSS_ID = BotId.make("bot-1");

const SPECIALIST_ID = BotId.make("bot-2");

const GROUP_ID = GroupId.make("group-1");

const ITEM_ID = WorkItemId.make("item-1");

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** An 8000-character brief, the longest the contract allows. */
const LONG_BRIEF = "brief ".repeat(1333) + "ta";

it.layer(TestLayerWithWorkItemReads)("work item shell preview", (it) => {
  it.effect("carries only a preview of a maximum-length brief, and the full one on demand", () =>
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshots = yield* ProjectionSnapshotQuery;
      const workItems = yield* ProjectionWorkItemRepository;

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
          createdAt: CREATED_AT,
        });
      }

      yield* engine.dispatch({
        type: "group.create",
        commandId: CommandId.make("cmd-group"),
        groupId: GROUP_ID,
        name: "Product",
        bossBotId: BOSS_ID,
        specialistBotIds: [SPECIALIST_ID],
        createdAt: CREATED_AT,
      });

      yield* engine.dispatch({
        type: "work-item.create",
        commandId: CommandId.make("cmd-item"),
        workItemId: ITEM_ID,
        groupId: GROUP_ID,
        title: "Fix the thing",
        brief: LONG_BRIEF,
        kind: "task",
      });

      assert.equal(LONG_BRIEF.length, 8000);

      const shell = yield* snapshots.getShellSnapshot();
      const summary = (shell.workItems ?? []).find((item) => item.id === ITEM_ID);

      assert.isDefined(summary);
      assert.isFalse(summary !== undefined && "brief" in summary);
      assert.isAtMost(summary?.briefPreview.length ?? Infinity, WORK_ITEM_PREVIEW_LIMIT);
      assert.equal(summary?.briefPreview.startsWith("brief brief"), true);
      assert.equal(summary?.briefPreview.endsWith("…"), true);
      // The whole shell payload stays far below one full brief.
      assert.isBelow(JSON.stringify(shell.workItems ?? []).length, 2000);

      const full = yield* workItems.get({ workItemId: ITEM_ID });

      assert.equal(full.brief, LONG_BRIEF);
    }),
  );
});
