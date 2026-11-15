import {
  BotId,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW as GROUP_NOW,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel as makeGroupReadModel,
  startTurnCommand,
} from "./test-support/GroupDeciderFixtures.ts";
import {
  NOW,
  createSession,
  makeReadModel as makeSettledReadModel,
} from "./test-support/SettledDeciderFixtures.ts";

/**
 * A throw that carries no refusal code says which claim it makes, and the two
 * claims expire differently: `internal-command` is closed by the contract, so it
 * cannot become reachable without a contract change; `no-shipped-surface` is
 * only closed by what shipped clients send today, so it ends the moment a
 * surface adds a control. One label for both would let the second hide under the
 * first, and nothing re-reads a row filed under the wrong one. Each case below
 * pins one throw to its claim and, for the contract-allowed ones, to the field
 * that keeps them open.
 */

const MESSAGE_ID = MessageId.make("message-1");

const userMessage = (): OrchestrationThread["messages"][number] => ({
  id: MESSAGE_ID,
  role: "user",
  text: "Continue",
  turnId: null,
  streaming: false,
  createdAt: NOW,
  updatedAt: NOW,
});

const groupModel = (): OrchestrationReadModel =>
  makeGroupReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
    ],
    groups: [makeGroup()],
    threads: [{ ...makeGroupThread(), messages: [userMessage()] }],
  });

/** A direct bot chat: no group, so the reaction and assistant paths check the thread's own bot. */
const directThread = (patch: Partial<OrchestrationThread> = {}): OrchestrationThread => ({
  ...makeGroupThread(),
  groupId: null,
  botId: BOSS_ID,
  messages: [userMessage()],
  ...patch,
});

const exclusionOf = (command: OrchestrationCommand, readModel: OrchestrationReadModel) =>
  decideOrchestrationCommand({ command, readModel }).pipe(
    Effect.flip,
    Effect.map((error) => {
      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected a command invariant error");
      }

      return error.exclusion;
    }),
  );

it.layer(NodeServices.layer)("invariant exclusions", (it) => {
  it.effect("files the contract-allowed throws as no-shipped-surface", () =>
    Effect.gen(function* () {
      // ClientThreadTurnStartCommand carries both addressing and respondingBotId,
      // so the contract allows both at once; no shipped composer sets both.
      const bothRoutes = yield* exclusionOf(
        { ...startTurnCommand(SPECIALIST_ID), addressing: { kind: "everyone" } },
        groupModel(),
      );

      expect(bothRoutes?.kind).toBe("no-shipped-surface");
      expect(bothRoutes?.reason).toContain("ClientThreadTurnStartCommand");

      // ThreadSessionStopCommand is client-dispatchable and carries onlyIfSettled;
      // only the server's own settle-stop parking dispatch sets it today.
      const conditionalStop = yield* exclusionOf(
        {
          type: "thread.session.stop",
          commandId: CommandId.make("cmd-stop-conditional"),
          threadId: ThreadId.make("thread-1"),
          createdAt: NOW,
          onlyIfSettled: true,
        },
        makeSettledReadModel(null, null, createSession("starting")),
      );

      expect(conditionalStop?.kind).toBe("no-shipped-surface");
      expect(conditionalStop?.reason).toContain("ThreadSessionStopCommand");
    }),
  );

  it.effect("files the contract-closed throws as internal-command", () =>
    Effect.gen(function* () {
      // senderPersonId is on the server-side ThreadTurnStartCommand only, so a
      // client turn start can never omit it.
      const noSender = yield* exclusionOf(startTurnCommand(SPECIALIST_ID, null), groupModel());

      expect(noSender?.kind).toBe("internal-command");

      // ThreadCreateCommand's schema filter rejects a payload carrying both ids.
      const bothOwners = yield* exclusionOf(
        {
          type: "thread.create",
          commandId: CommandId.make("cmd-create-both"),
          threadId: ThreadId.make("thread-both"),
          projectId: ProjectId.make("project-1"),
          botId: BOSS_ID,
          groupId: GROUP_ID,
          title: "Both owners",
          modelSelection: {
            instanceId: ProviderInstanceId.make("default"),
            model: "default-model",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: GROUP_NOW,
        },
        {
          ...makeGroupReadModel({ groups: [makeGroup()] }),
          projects: [
            {
              id: ProjectId.make("project-1"),
              title: "Project",
              workspaceRoot: "/workspace",
              defaultModelSelection: null,
              scripts: [],
              createdAt: GROUP_NOW,
              updatedAt: GROUP_NOW,
              deletedAt: null,
            },
          ],
        },
      );

      expect(bothOwners?.kind).toBe("internal-command");

      // A reaction without an actor and without a bot identity only comes from
      // the trusted-bot path, which always names a bot.
      const anonymousReaction = yield* exclusionOf(
        {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-reaction-anonymous"),
          threadId: ThreadId.make("thread-1"),
          messageId: MESSAGE_ID,
          emoji: "thumbs-up",
          present: true,
          updatedAt: NOW,
        },
        makeSettledReadModel(null, null, null, [], [userMessage()]),
      );

      expect(anonymousReaction?.kind).toBe("internal-command");

      // Inside the trusted-bot branch the server picks the bot itself: a group
      // reaction must name the responding bot or the boss.
      const groupReactionMismatch = yield* exclusionOf(
        {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-reaction-group"),
          threadId: ThreadId.make("thread-group"),
          messageId: MESSAGE_ID,
          botId: SPECIALIST_ID,
          emoji: "thumbs-up",
          present: true,
          updatedAt: GROUP_NOW,
        },
        groupModel(),
      );

      expect(groupReactionMismatch?.kind).toBe("internal-command");

      // A direct chat's trusted-bot reaction must name the thread's own bot.
      const directReactionMismatch = yield* exclusionOf(
        {
          type: "thread.message.reaction.set",
          commandId: CommandId.make("cmd-reaction-direct"),
          threadId: ThreadId.make("thread-group"),
          messageId: MESSAGE_ID,
          botId: SPECIALIST_ID,
          emoji: "thumbs-up",
          present: true,
          updatedAt: GROUP_NOW,
        },
        makeGroupReadModel({ threads: [directThread()] }),
      );

      expect(directReactionMismatch?.kind).toBe("internal-command");

      // Only the two internal assistant-message commands reach this: the voice
      // path carries no respondingBotId and returns before the check.
      const assistantMismatch = yield* exclusionOf(
        {
          type: "thread.message.assistant.delta",
          commandId: CommandId.make("cmd-delta"),
          threadId: ThreadId.make("thread-group"),
          messageId: MESSAGE_ID,
          delta: "text",
          respondingBotId: BotId.make("bot-other"),
          createdAt: GROUP_NOW,
        },
        makeGroupReadModel({ threads: [directThread()] }),
      );

      expect(assistantMismatch?.kind).toBe("internal-command");
    }),
  );
});
