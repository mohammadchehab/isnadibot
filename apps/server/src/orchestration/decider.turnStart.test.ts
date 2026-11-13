import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ThreadId,
  ProviderInstanceId,
  WorkItemId,
} from "@isnadi/contracts";
import { createModelSelection } from "@isnadi/shared/model";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { decideOrchestrationCommand } from "./decider.ts";
import type { DecideOrchestrationCommandResult } from "./decider/eventBase.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";
import { asEventId, asProjectId, asMessageId } from "./test-support/ProjectDeciderFixtures.ts";

const NOW = "2026-01-01T00:00:00.000Z";

/** A read model holding one project and one unstarted thread. */
const seededThread = Effect.gen(function* () {
  const withProject = yield* projectEvent(createEmptyReadModel(NOW), {
    sequence: 1,
    eventId: asEventId("evt-project-create"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-1"),
    type: "project.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-project-create"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-1"),
      title: "Project",
      workspaceRoot: "/tmp/project",
      defaultModelSelection: null,
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
    },
  });

  return yield* projectEvent(withProject, {
    sequence: 2,
    eventId: asEventId("evt-thread-create"),
    aggregateKind: "thread",
    aggregateId: ThreadId.make("thread-1"),
    type: "thread.created",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-thread-create"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-thread-create"),
    metadata: {},
    payload: {
      threadId: ThreadId.make("thread-1"),
      projectId: asProjectId("project-1"),
      title: "Thread",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
});

/** The single `thread.turn-start-requested` payload a turn start decides. */
const turnStartPayload = (result: DecideOrchestrationCommandResult) => {
  const events = Array.isArray(result) ? result : [result];
  const event = events.find((candidate) => candidate.type === "thread.turn-start-requested");

  if (event?.type !== "thread.turn-start-requested") {
    throw new Error("thread.turn.start decided no turn-start-requested event");
  }

  return event.payload;
};

it.layer(NodeServices.layer)("decider thread turns", (it) => {
  it.effect("emits user message and turn-start-requested events for thread.turn.start", () =>
    Effect.gen(function* () {
      const readModel = yield* seededThread;

      const result = yield* decideOrchestrationCommand({
        command: {
          type: "thread.turn.start",
          commandId: CommandId.make("cmd-turn-start"),
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: asMessageId("message-user-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
            { id: "reasoningEffort", value: "high" },
            { id: "fastMode", value: true },
          ]),
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          runtimeMode: "approval-required",
          createdAt: NOW,
        },
        readModel,
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(2);
      expect(events[0]?.type).toBe("thread.message-sent");
      const turnStartEvent = events[1];
      expect(turnStartEvent?.type).toBe("thread.turn-start-requested");
      expect(turnStartEvent?.causationEventId).toBe(events[0]?.eventId ?? null);

      expect(turnStartPayload(result)).toMatchObject({
        threadId: ThreadId.make("thread-1"),
        messageId: asMessageId("message-user-1"),
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.3-codex", [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ]),
        runtimeMode: "approval-required",
        trigger: { kind: "user", messageId: asMessageId("message-user-1") },
      });
    }),
  );

  it.effect(
    "keeps the dispatcher trigger and never lets a brief raise the chat's runtime or interaction mode",
    () =>
      Effect.gen(function* () {
        const readModel = yield* seededThread;

        const result = yield* decideOrchestrationCommand({
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("cmd-dispatcher-turn"),
            threadId: ThreadId.make("thread-1"),
            message: {
              messageId: asMessageId("dispatcher:brief-1"),
              role: "user",
              text: "TASK-1: fix the thing",
              attachments: [],
            },
            // Asks for more than the chat holds, in both modes; the chat's modes win.
            interactionMode: "plan",
            runtimeMode: "full-access",
            trigger: { kind: "dispatcher", workItemId: WorkItemId.make("work-item-1") },
            createdAt: NOW,
          },
          readModel,
        });

        expect(turnStartPayload(result)).toMatchObject({
          messageId: asMessageId("dispatcher:brief-1"),
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          trigger: { kind: "dispatcher", workItemId: WorkItemId.make("work-item-1") },
        });
      }),
  );
});
