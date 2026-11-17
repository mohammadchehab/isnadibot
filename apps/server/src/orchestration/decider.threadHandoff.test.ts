import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  BotId,
  CommandId,
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
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import type { DecideOrchestrationCommandResult } from "./decider/eventBase.ts";
import { createEmptyReadModel } from "./projector.ts";

const NOW = "2026-08-27T12:00:00.000Z";

const BOT_ID = BotId.make("bot-isnadi");

const OTHER_BOT_ID = BotId.make("bot-other");

const THREAD_ID = ThreadId.make("thread-direct");

const GROUP_ID = GroupId.make("group-product");

const PERSON_ID = AuthSessionId.make("person-1");

const COMMAND_ID = CommandId.make("cmd-handoff");

const ACTOR = { personId: PERSON_ID, canManageGroups: false };

function makeBot(botId: BotId): OrchestrationBot {
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
    archivedAt: null,
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

function makeThread(input: { readonly group: boolean }): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    botId: input.group ? null : BOT_ID,
    groupId: input.group ? GROUP_ID : null,
    respondingBotId: null,
    title: input.group ? "Product" : "Direct chat",
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
    messages: [makeMessage("message-1", "user"), makeMessage("message-2", "assistant")],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(input: { readonly group: boolean }): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(NOW),
    bots: [makeBot(BOT_ID), makeBot(OTHER_BOT_ID)],
    groups: input.group
      ? [
          {
            id: GROUP_ID,
            name: "Product",
            bossBotId: BOT_ID,
            members: [
              { kind: "bot", botId: BOT_ID, role: "boss" },
              { kind: "person", personId: PERSON_ID, displayName: "Mohammad" },
            ],
            fleetTemplateId: null,
            createdByBotId: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ]
      : [],
    threads: [makeThread(input)],
  };
}

const request = {
  type: "thread.handoff.request" as const,
  commandId: COMMAND_ID,
  threadId: THREAD_ID,
  botId: BOT_ID,
  createdAt: NOW,
};

const decidedEvents = (decided: DecideOrchestrationCommandResult) =>
  Array.isArray(decided) ? decided : [decided];

it.layer(NodeServices.layer)("thread hand off request", (it) => {
  it.effect("asks the bot of a direct chat to hand off, and starts a turn for it", () =>
    Effect.gen(function* () {
      const events = decidedEvents(
        yield* decideOrchestrationCommand({
          command: request,
          readModel: makeReadModel({ group: false }),
          actor: ACTOR,
        }),
      );

      expect(events.map((event) => event.type)).toEqual([
        "thread.message-sent",
        "thread.turn-start-requested",
      ]);
      expect(events[0]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId: `handoff:${COMMAND_ID}`,
        role: "user",
        authorPersonId: PERSON_ID,
      });
      expect(events[1]?.payload).toMatchObject({
        threadId: THREAD_ID,
        messageId: `handoff:${COMMAND_ID}`,
        runtimeMode: "full-access",
        interactionMode: "default",
        respondingBotId: BOT_ID,
        trigger: { kind: "handoff", botId: BOT_ID },
      });
    }),
  );

  it.effect("writes a brief the client can tell apart and hide", () =>
    Effect.gen(function* () {
      const events = decidedEvents(
        yield* decideOrchestrationCommand({
          command: request,
          readModel: makeReadModel({ group: false }),
          actor: ACTOR,
        }),
      );

      expect(events[0]).toMatchObject({
        payload: { text: expect.stringContaining("call the handoff tool") },
      });
    }),
  );

  it.effect("asks one bot of a group chat, addressing it by name", () =>
    Effect.gen(function* () {
      const events = decidedEvents(
        yield* decideOrchestrationCommand({
          command: request,
          readModel: makeReadModel({ group: true }),
          actor: ACTOR,
        }),
      );

      const turnStart = events.find((event) => event.type === "thread.turn-start-requested");

      expect(turnStart?.payload).toMatchObject({
        respondingBotId: BOT_ID,
        trigger: { kind: "handoff", botId: BOT_ID },
      });
    }),
  );

  it.effect("refuses a hand off of a bot that is not the bot of the chat", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...request, botId: OTHER_BOT_ID },
        readModel: makeReadModel({ group: false }),
        actor: ACTOR,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain(OTHER_BOT_ID);
    }),
  );

  it.effect("refuses a hand off of a bot that has left the group", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: { ...request, botId: OTHER_BOT_ID },
        readModel: makeReadModel({ group: true }),
        actor: ACTOR,
      }).pipe(Effect.flip);

      expect(error._tag).toBe("OrchestrationCommandInvariantError");
      expect(String(error)).toContain(OTHER_BOT_ID);
    }),
  );
});
