import {
  BotId,
  CommandId,
  EventId,
  GroupId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationBot,
  type OrchestrationMessage,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel } from "./projector.ts";

const NOW = "2026-08-27T12:00:00.000Z";

const BOT_ID = BotId.make("bot-isnadi");

const OTHER_BOT_ID = BotId.make("bot-other");

const THREAD_ID = ThreadId.make("thread-direct");

const GROUP_ID = GroupId.make("group-product");

const HANDOFF_ACTIVITY_ID = EventId.make("activity-handoff");

function makeBot(botId: BotId, archivedAt: string | null = null): OrchestrationBot {
  return {
    id: botId,
    name: "Isnadi",
    title: "Agent",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    skills: [],
    skillRegistryAccess: false,
    avatar: { kind: "dither", seed: botId },
    engine: null,
    sandbox: "local",
    runtimeMode: "full-access",
    imageProvider: null,
    voiceEnabled: true,
    channelBindings: [],
    groupId: null,
    archivedAt,
    createdAt: NOW,
    updatedAt: NOW,
    createdByBotId: null,
  };
}

function makeMessage(id: string, role: OrchestrationMessage["role"]): OrchestrationMessage {
  return {
    id: MessageId.make(id),
    role,
    text: `${role} ${id}`,
    turnId: null,
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

interface ReadModelOptions {
  readonly archived?: boolean;
  readonly group?: boolean;
}

function makeThread(options?: ReadModelOptions): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    botId: options?.group ? null : BOT_ID,
    groupId: options?.group ? GROUP_ID : null,
    respondingBotId: null,
    title: "Direct chat",
    modelSelection: { instanceId: ProviderInstanceId.make("default"), model: "default-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [
      makeMessage("message-1", "user"),
      makeMessage("message-2", "assistant"),
      makeMessage("message-3", "user"),
    ],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(options?: ReadModelOptions): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(NOW),
    bots: [makeBot(BOT_ID, options?.archived ? NOW : null), makeBot(OTHER_BOT_ID)],
    groups: options?.group
      ? [
          {
            id: GROUP_ID,
            name: "Product",
            bossBotId: BOT_ID,
            members: [{ kind: "bot", botId: BOT_ID, role: "boss" }],
            fleetTemplateId: null,
            createdByBotId: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]
      : [],
    threads: [makeThread(options)],
  };
}

const reset = {
  type: "thread.context.reset" as const,
  commandId: CommandId.make("cmd-context-reset"),
  threadId: THREAD_ID,
  botId: BOT_ID,
  sinceMessageId: MessageId.make("message-2"),
  handoffActivityId: HANDOFF_ACTIVITY_ID,
  createdAt: NOW,
};

const undo = {
  type: "thread.context.reset.undo" as const,
  commandId: CommandId.make("cmd-context-reset-undo"),
  threadId: THREAD_ID,
  botId: BOT_ID,
  createdAt: NOW,
};

it.layer(NodeServices.layer)("thread context epoch", (it) => {
  it.effect("cuts the bot's context after the message the reset names", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: reset,
        readModel: makeReadModel(),
      });

      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["thread.context-reset"]);
      expect(events[0]?.payload).toEqual({
        threadId: THREAD_ID,
        botId: BOT_ID,
        sinceMessageId: MessageId.make("message-2"),
        sinceSequence: 2,
        handoffActivityId: HANDOFF_ACTIVITY_ID,
        resetAt: NOW,
      });
    }),
  );

  it.effect("records a reset with no handoff note as one with no note", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: { ...reset, handoffActivityId: undefined },
        readModel: makeReadModel(),
      });

      const events = Array.isArray(decided) ? decided : [decided];
      expect(events[0]?.payload).toMatchObject({ handoffActivityId: null });
    }),
  );

  it.effect("refuses a cut at a message the chat no longer holds", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...reset, sinceMessageId: MessageId.make("message-gone") },
        readModel: makeReadModel(),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain("message-gone");
    }),
  );

  it.effect("refuses a reset for an archived bot", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: reset,
        readModel: makeReadModel({ archived: true }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain("is archived");
    }),
  );

  it.effect("refuses a reset for a bot that is not a member of the group chat", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...reset, botId: OTHER_BOT_ID },
        readModel: makeReadModel({ group: true }),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain(OTHER_BOT_ID);
    }),
  );

  it.effect("undoes the bot's cut", () =>
    Effect.gen(function* () {
      const decided = yield* decideOrchestrationCommand({
        command: undo,
        readModel: makeReadModel(),
      });

      const events = Array.isArray(decided) ? decided : [decided];
      expect(events.map((event) => event.type)).toEqual(["thread.context-reset-undone"]);
      expect(events[0]?.payload).toEqual({
        threadId: THREAD_ID,
        botId: BOT_ID,
        undoneAt: NOW,
      });
    }),
  );

  it.effect("refuses an undo for a bot that is not in the chat", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...undo, botId: OTHER_BOT_ID },
        readModel: makeReadModel(),
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain(OTHER_BOT_ID);
    }),
  );
});
