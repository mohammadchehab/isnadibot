import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  decodeClientOrchestrationCommand,
  decodeOrchestrationCommand,
} from "./orchestration.test-support.ts";

/**
 * E13 group work hands a bot the right to act on its group's items. That right
 * is decided from the actor the server stamps, never from anything a client
 * sends, so the wire boundary has to drop the identity fields even when the
 * payload is otherwise valid. A leaked `actorBotId` would let a client act as
 * any bot; a leaked `assignedByBotId` would forge who handed the item out.
 */
const SMUGGLED_IDENTITY = {
  actorBotId: "bot-smuggled",
  assignedByBotId: "bot-smuggled",
};

const CREATED_AT = "2026-11-13T12:00:00.000Z";

/** Every command a client may send that the group authorization path decides. */
const CLIENT_E13_COMMANDS: ReadonlyArray<{ readonly name: string; readonly payload: object }> = [
  {
    name: "work-item.create",
    payload: {
      type: "work-item.create",
      commandId: "cmd-create",
      workItemId: "item-1",
      groupId: "group-1",
      title: "Ship the release notes",
      brief: "Write the notes for Tuesday's build.",
      kind: "task",
    },
  },
  {
    name: "work-item.assign",
    payload: {
      type: "work-item.assign",
      commandId: "cmd-assign",
      workItemId: "item-1",
      ownerBotId: "bot-scout",
    },
  },
  {
    name: "work-item.update",
    payload: {
      type: "work-item.update",
      commandId: "cmd-update",
      workItemId: "item-1",
      title: "Renamed",
      state: "review",
    },
  },
  {
    name: "work-item.block",
    payload: {
      type: "work-item.block",
      commandId: "cmd-block",
      workItemId: "item-1",
      blockedOn: { by: "user", note: "Waiting on credentials" },
    },
  },
  {
    name: "work-item.unblock",
    payload: {
      type: "work-item.unblock",
      commandId: "cmd-unblock",
      workItemId: "item-1",
    },
  },
  {
    name: "work-item.close",
    payload: {
      type: "work-item.close",
      commandId: "cmd-close",
      workItemId: "item-1",
      resolution: "done",
    },
  },
  {
    name: "work-item.reopen",
    payload: {
      type: "work-item.reopen",
      commandId: "cmd-reopen",
      workItemId: "item-1",
    },
  },
  {
    name: "bot.create",
    payload: {
      type: "bot.create",
      commandId: "cmd-bot-create",
      botId: "bot-new",
      name: "Quill",
      title: "Release notes",
      avatar: { kind: "dither", seed: "quill" },
      engine: null,
      sandbox: null,
      groupId: "group-1",
      createdAt: CREATED_AT,
    },
  },
  {
    name: "thread.turn.interrupt",
    payload: {
      type: "thread.turn.interrupt",
      commandId: "cmd-interrupt",
      threadId: "thread-1",
      createdAt: CREATED_AT,
    },
  },
  {
    name: "thread.session.stop",
    payload: {
      type: "thread.session.stop",
      commandId: "cmd-stop",
      threadId: "thread-1",
      createdAt: CREATED_AT,
    },
  },
];

for (const { name, payload } of CLIENT_E13_COMMANDS) {
  it.effect(`${name} drops a bot identity a client smuggles in`, () =>
    Effect.gen(function* () {
      const decoded = yield* decodeClientOrchestrationCommand({
        ...payload,
        ...SMUGGLED_IDENTITY,
      });

      assert.strictEqual(decoded.type, name);
      assert.isFalse("actorBotId" in decoded);
      assert.isFalse("assignedByBotId" in decoded);
    }),
  );
}

/** The two commands the server builds for itself once it has resolved the acting bot. */
const claim = {
  type: "work-item.claim",
  commandId: "cmd-claim",
  botId: "bot-scout",
  workItemId: "item-1",
  createdAt: CREATED_AT,
};

const update = {
  type: "work-item.update",
  commandId: "cmd-update",
  workItemId: "item-1",
  title: "Renamed",
};

const botAct = {
  type: "work-item.bot-act",
  commandId: "cmd-bot-act",
  actorBotId: "bot-scout",
  command: update,
  createdAt: CREATED_AT,
};

it.effect("refuses a client-built claim", () =>
  Effect.gen(function* () {
    // Claiming stamps `botId` on the server, so a client that sends one is
    // trying to take an item without the dispatcher's queued-and-unowned check.
    const exit = yield* Effect.exit(decodeClientOrchestrationCommand(claim));

    assert.isTrue(Exit.isFailure(exit));
  }),
);

it.effect("refuses a client-built bot action", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(decodeClientOrchestrationCommand(botAct));

    assert.isTrue(Exit.isFailure(exit));
  }),
);

it.effect("accepts the claim and the bot action on the server side", () =>
  Effect.gen(function* () {
    const decodedClaim = yield* decodeOrchestrationCommand(claim);
    const decodedBotAct = yield* decodeOrchestrationCommand(botAct);

    assert.strictEqual(decodedClaim.type, "work-item.claim");
    assert.strictEqual(decodedBotAct.type, "work-item.bot-act");
  }),
);
