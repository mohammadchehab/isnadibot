import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  decodeClientOrchestrationCommand,
  decodeOrchestrationCommand,
} from "./orchestration.test-support.ts";

/**
 * A client is always dispatched as a person. Bot identity travels only through
 * the server-built `work-item.bot-act` wrapper, so nothing a client sends can
 * claim to be a bot.
 */
const update = {
  type: "work-item.update",
  commandId: "cmd-update",
  workItemId: "item-1",
  title: "Renamed",
};

it.effect("decodes a plain client work-item command", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeClientOrchestrationCommand(update);

    assert.strictEqual(decoded.type, "work-item.update");
  }),
);

it.effect("drops a bot identity smuggled into a client work-item command", () =>
  Effect.gen(function* () {
    // The schema keeps only declared keys, so an actorBotId a client sends never
    // survives to the decider; bot identity can only arrive through the wrapper below.
    const decoded = yield* decodeClientOrchestrationCommand({
      ...update,
      actorBotId: "bot-boss",
    });

    assert.strictEqual(decoded.type, "work-item.update");
    assert.isFalse("actorBotId" in decoded);
  }),
);

it.effect("refuses the bot wrapper from a client", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "work-item.bot-act",
        commandId: "cmd-bot-act",
        actorBotId: "bot-boss",
        command: update,
        createdAt: "2026-08-27T12:00:00.000Z",
      }),
    );

    assert.isTrue(Exit.isFailure(exit));
  }),
);

it.effect("decodes the bot wrapper on the server side only", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeOrchestrationCommand({
      type: "work-item.bot-act",
      commandId: "cmd-bot-act",
      actorBotId: "bot-boss",
      command: update,
      createdAt: "2026-08-27T12:00:00.000Z",
    });

    assert.strictEqual(decoded.type, "work-item.bot-act");
  }),
);
