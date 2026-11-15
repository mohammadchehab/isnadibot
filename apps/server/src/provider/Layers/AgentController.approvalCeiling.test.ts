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
  approvalCeiling: IsnadiDelegationAccessGrant["approvalCeiling"],
): IsnadiDelegationAccessGrant => ({
  allowedToolIds: ["ExternalShell"],
  memoryScopes: [],
  sandbox: "local",
  runtimeMode: "approval-required",
  hasUserComputer: true,
  enabledMcpServerIds: [],
  disabledMcpServerIds: [],
  approvalCeiling,
});

/** Runs one delegated `ExternalShell` call and reports what the chat did with it. */
const runDelegatedCall = (
  approvalCeiling: IsnadiDelegationAccessGrant["approvalCeiling"],
  args: { readonly command: string },
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
      accessForThread: () => delegatedAccess(approvalCeiling),
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
    yield* controller.sendTurn({ threadId: codexThreadId, input: "Clean the build output." });
    mastra.emit({
      type: "tool_approval_required",
      toolCallId: "delegated-call",
      toolName: "ExternalShell",
      args,
    } as AgentControllerEvent);
    yield* Effect.yieldNow;

    yield* Fiber.interrupt(eventsFiber);

    return { mastra, events };
  }).pipe(Effect.provide(layer), Effect.orDie);
};

const deleteCommand = { command: "rm -rf dist" };

const plainWriteCommand = { command: "cat > notes.md <<'EOF'\nA plain note.\nEOF" };

describe("AgentControllerLive", () => {
  it.effect("refuses a delegated action above its ceiling without asking the user", () =>
    Effect.gen(function* () {
      const { mastra, events } = yield* runDelegatedCall("user-computer", deleteCommand);

      // The runtime would refuse this call after the user answered, so the card
      // never goes out: the answer could not have changed anything.
      expect(events.filter((event) => event.type === "request.opened")).toEqual([]);
      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
        toolCallId: "delegated-call",
        decision: "decline",
        declineContext: {
          reason: "approval_ceiling",
          message:
            "Tool 'ExternalShell' is a 'delete' action, and this chat's approval ceiling is 'user-computer', so approving it here would not run it. Do the work another way, or ask your user to run it.",
        },
      });
    }),
  );

  it.effect("still asks the user for the same action when the ceiling allows it", () =>
    Effect.gen(function* () {
      const { mastra, events } = yield* runDelegatedCall("delete", deleteCommand);

      expect(events.filter((event) => event.type === "request.opened")).toHaveLength(1);
      expect(mastra.session.respondToToolApproval).not.toHaveBeenCalled();
    }),
  );

  it.effect("keeps asking for a plain write, which the ceiling already allows", () =>
    Effect.gen(function* () {
      const { mastra, events } = yield* runDelegatedCall("user-computer", plainWriteCommand);

      expect(events.filter((event) => event.type === "request.opened")).toHaveLength(1);
      expect(mastra.session.respondToToolApproval).not.toHaveBeenCalled();
    }),
  );
});
