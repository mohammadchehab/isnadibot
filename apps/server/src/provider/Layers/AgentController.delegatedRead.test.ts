import type { AgentControllerEvent } from "@mastra/core/agent-controller";
import {
  BotId,
  ProviderDriverKind,
  type IsnadiDelegationAccessGrant,
  type ProviderRuntimeEvent,
} from "@isnadi/contracts";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
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
  cwd: string = process.cwd(),
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
      cwd,
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

/** A granted folder with a README, a sibling folder outside it, and a link that leaves it. */
const makeFolders = () => {
  const base = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "isnadi-read-")),
  );

  const root = NodePath.join(base, "project");
  const outside = NodePath.join(base, "elsewhere");

  NodeFS.mkdirSync(root);
  NodeFS.mkdirSync(outside);
  NodeFS.writeFileSync(NodePath.join(root, "README.md"), "# Project");
  NodeFS.writeFileSync(NodePath.join(outside, "notes.txt"), "private");
  NodeFS.symlinkSync(outside, NodePath.join(root, "link-out"));

  return { root, outside };
};

const declined = (message: string) => ({
  toolCallId: "delegated-call",
  decision: "decline",
  declineContext: { reason: "approval_ceiling", message: expect.stringContaining(message) },
});

describe("AgentControllerLive delegated reads", () => {
  it.effect("lets a read-only delegation read inside its folder without a card", () =>
    Effect.gen(function* () {
      const { root } = makeFolders();
      const { mastra, events } = yield* runDelegatedCall({}, { path: "README.md" }, root);

      expect(events.filter((event) => event.type === "request.opened")).toEqual([]);
      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith({
        toolCallId: "delegated-call",
        decision: "approve",
      });
    }),
  );

  it.effect("refuses a read outside the folder, naming the folder", () =>
    Effect.gen(function* () {
      const { root, outside } = makeFolders();

      const { mastra, events } = yield* runDelegatedCall(
        {},
        { path: NodePath.join(outside, "notes.txt") },
        root,
      );

      expect(events.filter((event) => event.type === "request.opened")).toEqual([]);
      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        declined("may only read inside the granted folder"),
      );
    }),
  );

  it.effect("refuses a symlink inside the folder that points out of it", () =>
    Effect.gen(function* () {
      const { root } = makeFolders();
      const { mastra } = yield* runDelegatedCall({}, { path: "link-out/notes.txt" }, root);

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        declined("resolves outside it"),
      );
    }),
  );

  it.effect("refuses a .. escape", () =>
    Effect.gen(function* () {
      const { root } = makeFolders();
      const { mastra } = yield* runDelegatedCall({}, { path: "../elsewhere/notes.txt" }, root);

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        declined("resolves outside it"),
      );
    }),
  );

  it.effect("names the missing grant when the delegation has no user computer", () =>
    Effect.gen(function* () {
      const { root } = makeFolders();

      const { mastra } = yield* runDelegatedCall(
        { hasUserComputer: false },
        { path: "README.md" },
        root,
      );

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        declined("not granted user-computer access"),
      );
    }),
  );

  it.effect("still refuses a protected path inside the folder", () =>
    Effect.gen(function* () {
      const { root } = makeFolders();
      NodeFS.writeFileSync(NodePath.join(root, ".env"), "KEY=1");
      const { mastra } = yield* runDelegatedCall({}, { path: ".env" }, root);

      expect(mastra.session.respondToToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "decline" }),
      );
    }),
  );
});
