import {
  BotId,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DelegationId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@isnadi/contracts";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { afterEach, describe, expect } from "vite-plus/test";

import {
  asMessageId,
  asProjectId,
  createProviderCommandHarness,
} from "./test-support/ProviderCommandHarness.ts";

const PARENT_THREAD_ID = ThreadId.make("thread-1");

const PARENT_BOT_ID = BotId.make("bot-1");

const CHILD_BOT_ID = BotId.make("bot-child");

const CHILD_THREAD_ID = ThreadId.make("delegation-wake-child");

const CHILD_TURN_ID = TurnId.make("delegation-wake-child-turn");

const DELEGATION_ID = DelegationId.make("delegation-wake");

const NOW = "2026-01-01T00:00:00.000Z";

const testScope = createProviderCommandHarness();

type Harness = Awaited<ReturnType<typeof testScope.createHarness>>;

type Snapshot = Awaited<ReturnType<Harness["readModel"]>>;

/**
 * A boss that delegated with `keep: true` and a child that is still working.
 * The delegation result is pending (Completed, unacknowledged) once the child
 * finishes, which is the state the wake reactor exists to act on.
 */
const seedDelegation = (harness: Harness) =>
  Effect.gen(function* () {
    yield* harness.engine.dispatch({
      type: "bot.create",
      commandId: CommandId.make("cmd-wake-child-bot"),
      botId: CHILD_BOT_ID,
      name: "Child bot",
      title: "Child bot",
      avatar: { kind: "dither", seed: "child-bot" },
      engine: null,
      sandbox: "local",
      runtimeMode: "approval-required",
      groupId: null,
      createdAt: NOW,
    });
    yield* harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-wake-child-thread"),
      threadId: CHILD_THREAD_ID,
      projectId: asProjectId("project-1"),
      botId: CHILD_BOT_ID,
      parentThreadId: PARENT_THREAD_ID,
      parentDelegationId: DELEGATION_ID,
      title: "Delegated work",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5-codex" },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    });

    const queued = {
      delegationId: DELEGATION_ID,
      parentDelegationId: null,
      parentBotId: PARENT_BOT_ID,
      childBotId: CHILD_BOT_ID,
      parentThreadId: PARENT_THREAD_ID,
      parentTurnId: TurnId.make("turn-parent"),
      ancestorBotIds: [PARENT_BOT_ID],
      depth: 1,
      task: "Research the answer.",
      expectedResult: "A concise answer.",
      deadline: null,
      access: {
        allowedToolIds: ["Read" as const],
        memoryScopes: [],
        sandbox: "local" as const,
        runtimeMode: "approval-required" as const,
        hasUserComputer: false,
        enabledMcpServerIds: [],
        disabledMcpServerIds: [],
        approvalCeiling: "send" as const,
      },
      phase: { _tag: "Queued" as const },
      billedBotId: CHILD_BOT_ID,
      keep: true,
      anchorMessageId: null,
      retryOfDelegationId: null,
      trigger: "bot" as const,
      createdAt: NOW,
      updatedAt: NOW,
    };

    yield* harness.engine.dispatch({
      type: "delegation.create",
      commandId: CommandId.make("cmd-wake-create"),
      delegation: queued,
    });
    yield* harness.engine.dispatch({
      type: "delegation.state.set",
      commandId: CommandId.make("cmd-wake-running"),
      delegation: {
        ...queued,
        phase: {
          _tag: "Running",
          childThreadId: CHILD_THREAD_ID,
          childTurnId: CHILD_TURN_ID,
          startedAt: NOW,
          progress: null,
        },
      },
    });

    return queued;
  });

type SeedRecord = Effect.Success<ReturnType<typeof seedDelegation>>;

const finishChild = (harness: Harness, queued: SeedRecord) =>
  harness.engine.dispatch({
    type: "delegation.state.set",
    commandId: CommandId.make("cmd-wake-completed"),
    delegation: {
      ...queued,
      phase: {
        _tag: "Completed" as const,
        childThreadId: CHILD_THREAD_ID,
        childTurnId: CHILD_TURN_ID,
        startedAt: NOW,
        completedAt: NOW,
        acknowledgedAt: null,
        result: {
          summary: "The answer is 42.",
          childThreadId: CHILD_THREAD_ID,
          childTurnId: CHILD_TURN_ID,
        },
      },
    },
  });

const setParentSession = (harness: Harness, status: "running" | "stopped", commandId: string) =>
  harness.engine.dispatch({
    type: "thread.session.set",
    commandId: CommandId.make(commandId),
    threadId: PARENT_THREAD_ID,
    session: {
      threadId: PARENT_THREAD_ID,
      status,
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      mcpServerIds: [],
      activeTurnId: status === "running" ? TurnId.make("turn-parent") : null,
      lastError: null,
      updatedAt: NOW,
    },
    createdAt: NOW,
  });

const startParentTurn = (harness: Harness) =>
  harness.engine.dispatch({
    type: "thread.turn.start",
    commandId: CommandId.make("cmd-wake-parent-turn"),
    threadId: PARENT_THREAD_ID,
    message: {
      messageId: asMessageId("user-message-wake"),
      role: "user",
      text: "Send this to the child bot.",
      attachments: [],
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    createdAt: NOW,
  });

const phaseOf = (snapshot: Snapshot) =>
  snapshot.delegations.find((delegation) => delegation.delegationId === DELEGATION_ID)?.phase;

const sessionOf = (snapshot: Snapshot) =>
  snapshot.threads.find((thread) => thread.id === PARENT_THREAD_ID)?.session;

describe("DelegationWakeReactor", () => {
  const { createHarness } = testScope;
  afterEach(testScope.dispose);

  effectIt.effect(
    "the delegating bot picks up a finished child's result with no user message",
    () =>
      Effect.gen(function* () {
        const harness = yield* Effect.promise(() => createHarness({ botEngine: null }));
        const queued = yield* seedDelegation(harness);

        // The boss answers its own turn, then goes idle while the child still
        // works. That order is the whole point: a wake is owed only because the
        // boss is already idle when the result lands.
        yield* startParentTurn(harness);
        yield* Effect.promise(() => harness.drain());
        yield* setParentSession(harness, "stopped", "cmd-wake-parent-idle");
        expect(harness.sendTurn).toHaveBeenCalledTimes(1);

        // The condition the card's own false positive turns on, asserted before
        // the child finishes.
        const beforeChildFinishes = yield* Effect.promise(() => harness.readModel());
        expect(sessionOf(beforeChildFinishes)?.status).toBe("stopped");
        expect(phaseOf(beforeChildFinishes)).toMatchObject({ _tag: "Running" });

        const wakeScope = yield* Scope.make();

        const wakeReactor = yield* Effect.promise(() =>
          harness.startDelegationWakeReactor(wakeScope),
        );

        // A boss waiting on a running child is owed nothing.
        yield* wakeReactor.drain;
        expect(harness.sendTurn).toHaveBeenCalledTimes(1);

        // The child finishes. Nobody sends the boss a message.
        const finished = yield* finishChild(harness, queued);

        yield* wakeReactor.drainThrough(finished.sequence);

        // The proof this test exists for: the parent provider is invoked again
        // with the child's result, driven by the wake alone.
        yield* Effect.promise(() =>
          harness.waitFor(() => harness.sendTurn.mock.calls.length === 2),
        );
        expect(harness.sendTurn.mock.calls.at(-1)?.[0]).toMatchObject({
          threadId: PARENT_THREAD_ID,
          delegationResults: expect.stringContaining("The answer is 42."),
        });

        // Acknowledged once, so the card reads "delivered" instead of "picking up".
        const afterWake = yield* Effect.promise(() => harness.readModel());
        expect(phaseOf(afterWake)).toMatchObject({ _tag: "Completed" });
        expect(phaseOf(afterWake)).toHaveProperty("acknowledgedAt", expect.any(String));

        yield* Scope.close(wakeScope, Exit.void);
      }).pipe(Effect.scoped),
  );

  effectIt.effect("a boss still mid-turn is not woken until its own turn ends", () =>
    Effect.gen(function* () {
      const harness = yield* Effect.promise(() => createHarness({ botEngine: null }));
      const queued = yield* seedDelegation(harness);

      yield* startParentTurn(harness);
      yield* Effect.promise(() => harness.drain());
      yield* setParentSession(harness, "running", "cmd-wake-parent-running");

      const wakeScope = yield* Scope.make();

      const wakeReactor = yield* Effect.promise(() =>
        harness.startDelegationWakeReactor(wakeScope),
      );

      // The result lands while the boss is still mid-turn. No wake is owed: a
      // live turn would acknowledge the result itself on its next start.
      const finished = yield* finishChild(harness, queued);

      yield* wakeReactor.drainThrough(finished.sequence);
      expect(harness.sendTurn).toHaveBeenCalledTimes(1);

      // The boss's own turn ends. Now the result is due, and the same reactor
      // picks it up without anyone asking.
      const idle = yield* setParentSession(harness, "stopped", "cmd-wake-parent-later-idle");

      yield* wakeReactor.drainThrough(idle.sequence);

      yield* Effect.promise(() => harness.waitFor(() => harness.sendTurn.mock.calls.length === 2));
      expect(harness.sendTurn.mock.calls.at(-1)?.[0]).toMatchObject({
        threadId: PARENT_THREAD_ID,
        delegationResults: expect.stringContaining("The answer is 42."),
      });

      yield* Scope.close(wakeScope, Exit.void);
    }).pipe(Effect.scoped),
  );
});
