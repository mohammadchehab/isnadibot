import {
  AuthSessionId,
  BotId,
  ClientOrchestrationCommand,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  OrchestrationDispatchCommandError,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { applyAuthenticatedCommandActor } from "./AuthenticatedCommand.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { toDispatchCommandError } from "./dispatchCommandError.ts";
import {
  internalInvariantError,
  pendingRefusalInvariantError,
  refusedInvariantError,
} from "./Errors.ts";
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

/** What a client actually receives: the error encoded against its wire schema. */
const encodeDispatchError = Schema.encodeEffect(OrchestrationDispatchCommandError);

/** Whether a payload survives the contract a client dispatch is decoded against. */
const clientCanDispatch = Schema.is(ClientOrchestrationCommand);

/** The actor every client dispatch supplies before the decider sees the command. */
const CLIENT_ACTOR = { personId: AuthSessionId.make("person-client"), canManageGroups: false };

/**
 * The same actor as the WS handler passes it, which also carries a display name.
 * `canManageGroups` is true so the group membership guard, which sits after the
 * sender guard, does not mask the claim under test.
 */
const AUTHENTICATED_ACTOR = {
  ...CLIENT_ACTOR,
  canManageGroups: true,
  displayName: "Client person",
};

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

  it.effect("files the schema-closed throws as internal-command", () =>
    Effect.gen(function* () {
      // The claim is "a client cannot dispatch it", so hold it against the
      // contract a client dispatch is decoded against. Asserting only the label
      // would restate the throw's own comment.
      //
      // ThreadCreateCommand's schema filter rejects a payload carrying both ids.
      const bothOwnersCommand: OrchestrationCommand = {
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
      };

      expect(clientCanDispatch(bothOwnersCommand)).toBe(false);

      const bothOwners = yield* exclusionOf(bothOwnersCommand, {
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
      });

      expect(bothOwners?.kind).toBe("internal-command");

      // Only the two internal assistant-message commands reach this: the voice
      // path carries no respondingBotId and returns before the check.
      const assistantMismatchCommand: OrchestrationCommand = {
        type: "thread.message.assistant.delta",
        commandId: CommandId.make("cmd-delta"),
        threadId: ThreadId.make("thread-group"),
        messageId: MESSAGE_ID,
        delta: "text",
        respondingBotId: BotId.make("bot-other"),
        createdAt: GROUP_NOW,
      };

      expect(clientCanDispatch(assistantMismatchCommand)).toBe(false);

      const assistantMismatch = yield* exclusionOf(assistantMismatchCommand, {
        ...makeGroupReadModel({ threads: [directThread()] }),
      });

      expect(assistantMismatch?.kind).toBe("internal-command");
    }),
  );

  /**
   * These four rows are what the widened `internal-command` sentence exists for:
   * the schema accepts every one of them, so "a client cannot dispatch it" is
   * false for the contract and true only of the dispatch path. Each row below is
   * therefore pinned twice — the payload decodes as a client command, and the
   * guard it is filed under needs an input the dispatch path always supplies.
   */
  it.effect("files the dispatch-path-closed throws as internal-command", () =>
    Effect.gen(function* () {
      // A turn start without a sender decodes: ClientThreadTurnStartCommand has no
      // senderPersonId field at all, so the shape a client sends is exactly this
      // one. What closes it is the handler, which stamps the sender on the way in.
      const noSenderCommand = startTurnCommand(SPECIALIST_ID, null);

      expect(clientCanDispatch(noSenderCommand)).toBe(true);

      const noSender = yield* exclusionOf(noSenderCommand, groupModel());

      expect(noSender?.kind).toBe("internal-command");

      // A reaction without an actor and without a bot identity only comes from
      // the trusted-bot path, which always names a bot.
      const anonymousReactionCommand: OrchestrationCommand = {
        type: "thread.message.reaction.set",
        commandId: CommandId.make("cmd-reaction-anonymous"),
        threadId: ThreadId.make("thread-1"),
        messageId: MESSAGE_ID,
        emoji: "thumbs-up",
        present: true,
        updatedAt: NOW,
      };

      expect(clientCanDispatch(anonymousReactionCommand)).toBe(true);

      const anonymousReaction = yield* exclusionOf(
        anonymousReactionCommand,
        makeSettledReadModel(null, null, null, [], [userMessage()]),
      );

      expect(anonymousReaction?.kind).toBe("internal-command");

      // Inside the trusted-bot branch the server picks the bot itself: a group
      // reaction must name the responding bot or the boss.
      const groupReactionMismatchCommand: OrchestrationCommand = {
        type: "thread.message.reaction.set",
        commandId: CommandId.make("cmd-reaction-group"),
        threadId: ThreadId.make("thread-group"),
        messageId: MESSAGE_ID,
        botId: SPECIALIST_ID,
        emoji: "thumbs-up",
        present: true,
        updatedAt: GROUP_NOW,
      };

      expect(clientCanDispatch(groupReactionMismatchCommand)).toBe(true);

      const groupReactionMismatch = yield* exclusionOf(groupReactionMismatchCommand, groupModel());

      expect(groupReactionMismatch?.kind).toBe("internal-command");

      // A direct chat's trusted-bot reaction must name the thread's own bot.
      const directReactionMismatchCommand: OrchestrationCommand = {
        type: "thread.message.reaction.set",
        commandId: CommandId.make("cmd-reaction-direct"),
        threadId: ThreadId.make("thread-group"),
        messageId: MESSAGE_ID,
        botId: SPECIALIST_ID,
        emoji: "thumbs-up",
        present: true,
        updatedAt: GROUP_NOW,
      };

      expect(clientCanDispatch(directReactionMismatchCommand)).toBe(true);

      const directReactionMismatch = yield* exclusionOf(
        directReactionMismatchCommand,
        makeGroupReadModel({ threads: [directThread()] }),
      );

      expect(directReactionMismatch?.kind).toBe("internal-command");
    }),
  );

  /**
   * The other half of the claim above: a client-dispatchable payload really is
   * out of the guard's reach once the dispatch path has stamped its actor. Each
   * command is dispatched exactly as a client would send it and is expected to
   * produce the person's reaction rather than the trusted-bot throw.
   */
  it.effect("lets a client's own command through the actor-gated guards", () =>
    Effect.gen(function* () {
      // The turn start filed above, dispatched the way the WS handler dispatches
      // it: the sender is stamped on before the decider runs, so the guard's
      // `senderPersonId === undefined` cannot hold and the turn is accepted.
      const stampedTurn = applyAuthenticatedCommandActor(
        startTurnCommand(SPECIALIST_ID, null),
        AUTHENTICATED_ACTOR,
      );

      expect(stampedTurn.type === "thread.turn.start" && stampedTurn.senderPersonId).toBe(
        AUTHENTICATED_ACTOR.personId,
      );

      yield* decideOrchestrationCommand({
        command: stampedTurn,
        readModel: groupModel(),
        actor: AUTHENTICATED_ACTOR,
      });

      const reaction = (commandId: string): OrchestrationCommand => ({
        type: "thread.message.reaction.set",
        commandId: CommandId.make(commandId),
        threadId: ThreadId.make("thread-1"),
        messageId: MESSAGE_ID,
        emoji: "thumbs-up",
        present: true,
        updatedAt: NOW,
      });

      const readModel = makeSettledReadModel(null, null, null, [], [userMessage()]);

      // Without an actor this is the anonymous reaction filed above.
      const withoutActor = yield* exclusionOf(reaction("cmd-reaction-no-actor"), readModel);

      expect(withoutActor?.kind).toBe("internal-command");

      // With one — what wsOrchestrationHandlers and http both supply before the
      // decider runs — the same payload is accepted and attributed to the person.
      const withActor = yield* decideOrchestrationCommand({
        command: reaction("cmd-reaction-with-actor"),
        readModel,
        actor: CLIENT_ACTOR,
      });

      expect(withActor).toMatchObject({
        type: "thread.message-reaction-set",
        payload: { personId: CLIENT_ACTOR.personId },
      });
    }),
  );

  /**
   * The exclusions above are for the server's log and for a test. Only `refusal`
   * crosses the wire, because only `refusal` has a sentence on a client. An
   * exclusion's written reason names the command type and the field that keeps
   * the guard open, and a pending refusal's ticket names internal work — neither
   * is a sentence a user should read, and neither may reach a client.
   */
  it.effect("carries only the refusal code onto the wire", () =>
    Effect.gen(function* () {
      const detail = "Thread 'thread-1' is archived.";

      // The positive control: a coded throw keeps its code, so the assertions
      // below cannot pass by the translation dropping everything.
      const refused = toDispatchCommandError(
        refusedInvariantError({ commandType: "thread.update", detail, refusal: "stale-view" }),
        "fallback",
      );

      expect(refused.refusal).toBe("stale-view");
      expect(refused.message).toContain(detail);

      const excluded = toDispatchCommandError(
        internalInvariantError({
          commandType: "thread.update",
          detail,
          reason: "ThreadUpdateCommand rejects this at decode.",
        }),
        "fallback",
      );

      // The sentence still reaches the client as the fallback it can print.
      expect(excluded.message).toContain(detail);
      expect(excluded.refusal).toBeUndefined();
      expect(excluded).not.toHaveProperty("exclusion");
      expect(excluded).not.toHaveProperty("failure");

      // The written reason names the command type and the field that keeps the
      // guard open, which is a fact for the server's log and not a sentence a
      // user reads. It must not survive the encode either.
      const excludedWire = yield* encodeDispatchError(excluded);

      expect(JSON.stringify(excludedWire)).not.toContain("rejects this at decode");

      const pending = toDispatchCommandError(
        pendingRefusalInvariantError({
          commandType: "thread.update",
          detail,
          reason: "The archived flag has no code of its own yet.",
          ticket: "TASK-000",
        }),
        "fallback",
      );

      expect(pending.message).toContain(detail);
      expect(pending.refusal).toBeUndefined();
      expect(pending).not.toHaveProperty("failure");

      // The ticket is internal work, not a user-facing code. The throw rides on
      // the error as its `cause`, and a `Defect` encodes an `Error` as
      // `{ name, message }` — so only the sentence reaches the wire while the
      // ticket and the reason stay on the server. Assert the encoded form, not
      // the in-process object, because the encoded form is what a client reads.
      const pendingWire = yield* encodeDispatchError(pending);

      expect(JSON.stringify(pendingWire)).not.toContain("TASK-000");
      expect(JSON.stringify(pendingWire)).not.toContain("has no code of its own yet");
    }),
  );
});
