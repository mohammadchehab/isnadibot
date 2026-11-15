import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  BotId,
  ProviderDriverKind,
  type IsnadiDelegationAccessGrant,
  type ProviderRuntimeEvent,
} from "@isnadi/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";
import { AgentController } from "../Services/AgentController.ts";
import {
  codexThreadId,
  codexInstanceId,
  codexSelection,
} from "./test-support/agentControllerFixtures.ts";
import { makeBridge, makeLayer, resolveCodex } from "./test-support/agentControllerLayers.ts";
import { mastraHarnessFixture } from "./test-support/agentControllerHarness.ts";

const delegatedAccess = (
  overrides: Partial<IsnadiDelegationAccessGrant>,
): IsnadiDelegationAccessGrant => ({
  allowedToolIds: ["ExternalRead"],
  memoryScopes: [],
  sandbox: "local",
  runtimeMode: "approval-required",
  hasUserComputer: true,
  enabledMcpServerIds: [],
  disabledMcpServerIds: [],
  approvalCeiling: "none",
  ...overrides,
});

/** Runs one delegated `ExternalRead` call and reports what the chat did with it. */
const runDelegatedCall = (
  overrides: Partial<IsnadiDelegationAccessGrant>,
  args: { readonly path: string },
) => {
  const bridge = makeBridge();
  const mastra = mastraHarnessFixture();

  const layer = makeLayer(
    bridge.service,
    mastra.factory,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      send: vi.fn(async () => {
        throw new Error("not used");
      }),
      sendToUser: vi.fn(async () => {
        throw new Error("not used");
      }),
      parentFinished: vi.fn(async () => undefined),
      accessForThread: () => delegatedAccess(overrides),
    },
  );

  return Effect.gen(function* () {
    const controller = yield* AgentController;
    yield* resolveCodex(controller);
    yield* controller.startSession(codexThreadId, {
      threadId: codexThreadId,
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: codexInstanceId,
      cwd: process.cwd(),
      botId: BotId.make("delegated-child"),
      modelSelection: codexSelection,
      runtimeMode: "approval-required",
    });

    const events: ProviderRuntimeEvent[] = [];

    const eventsFiber = yield* controller.streamEvents.pipe(
      Stream.runForEach((event) => Effect.sync(() => events.push(event))),
      Effect.forkChild({ startImmediately: true }),
    );

    yield* Effect.yieldNow;
    yield* controller.sendTurn({ threadId: codexThreadId, input: "Review the project folder." });
    mastra.emit({
      type: "tool_approval_required",
      toolCallId: "delegated-call",
      toolName: "ExternalRead",
      args,
    } as AgentControllerEvent);
    yield* Effect.yieldNow;

    yield* Fiber.interrupt(eventsFiber);

    return { mastra, events };
  }).pipe(Effect.provide(layer), Effect.orDie);
};

const readme = { path: "/Users/someone/project/README.md" };

describe("AgentControllerLive delegated reads", () => {
  it.effect("lets a read-only delegation read the user's files without a card", () =>
    Effect.gen(function* () {
      const { mastra, events } = yield* runDelegatedCall({}, readme);

      expect(events.filter((event) => event.type === "request.opened")).toEqual([]);
      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
        toolCallId: "delegated-call",
        decision: "approve",
      });
    }),
  );

  it.effect("names the missing grant when the delegation has no user computer", () =>
    Effect.gen(function* () {
      const { mastra } = yield* runDelegatedCall({ hasUserComputer: false }, readme);

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
        toolCallId: "delegated-call",
        decision: "decline",
        declineContext: {
          reason: "approval_ceiling",
          message: expect.stringContaining("not granted user-computer access"),
        },
      });
    }),
  );

  it.effect("still refuses a protected path under the same grant", () =>
    Effect.gen(function* () {
      const { mastra } = yield* runDelegatedCall({}, { path: "/Users/someone/project/.env" });

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "decline" }),
      );
    }),
  );
});
