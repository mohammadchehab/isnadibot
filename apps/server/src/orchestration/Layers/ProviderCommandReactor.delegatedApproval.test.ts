import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ProviderInstanceId,
  ThreadId,
} from "@isnadi/contracts";
import { createModelSelection } from "@isnadi/shared/model";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { createIsnadiToolRuntime } from "../../provider/IsnadiToolRuntime.ts";
import { makeIsnadiToolRuntimeTestSupport } from "../../provider/test-support/IsnadiToolRuntime.ts";
import {
  asApprovalRequestId,
  asProjectId,
  createProviderCommandHarness,
} from "./test-support/ProviderCommandHarness.ts";

const CHILD = ThreadId.make("thread-1");

const PARENT = ThreadId.make("thread-parent");

/** The id the harness gives the approval it stages on the child before the reactor starts. */
const REQUEST_ID = "approval-before-restart";

const NOW = "2026-01-01T00:00:00.000Z";

/**
 * A delegated child thread parked on a Shell write it may not run without an answer. The reactor
 * forwards the answer to the child's own session, and that session's runtime is the real one, so
 * what lands on disk is the command really running rather than a stubbed effect claiming it did.
 */
async function stageDelegatedWrite(
  createHarness: ReturnType<typeof createProviderCommandHarness>["createHarness"],
) {
  const support = makeIsnadiToolRuntimeTestSupport();
  const workspace = support.workspace("delegated-approval");
  const proofPath = NodePath.join(support.workspaceRoot(workspace), "proof.txt");
  const runtime = createIsnadiToolRuntime();

  runtime.registerSession(String(CHILD), {
    runtimeMode: "approval-required",
    workspaceType: "local",
    workspace,
  });

  const write = {
    threadId: String(CHILD),
    toolId: "Shell" as const,
    toolCallId: "call-delegated-write",
    input: { command: `printf '%s' 'delegated write' > ${proofPath}` },
    approvalMode: "require-grant" as const,
  };

  await expect(runtime.execute(write)).rejects.toThrow("requires approval");

  const harness = await createHarness({
    delegatedChild: true,
    runningTurnBeforeReactor: true,
    pendingRequestBeforeReactor: "approval",
    respondToRequestEffect: (request) =>
      Effect.promise(async () => {
        // A provider resumes the answered thread's turn and re-runs the command it was parked on.
        if (request.decision !== "accept" || String(request.threadId) !== write.threadId) return;

        runtime.grantApproval(write);
        await runtime.execute(write);
      }),
  });

  await harness.drain();

  // The chat that asked for the work. It exists so that answering the wrong thread is a command the
  // server accepts, and the test then has to catch the mistake by what it does, not by a refusal.
  await harness.runEffect(
    harness.engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make("cmd-parent-thread-create"),
      threadId: PARENT,
      projectId: asProjectId("project-1"),
      title: "Crew",
      modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol"),
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: NOW,
    }),
  );

  return {
    harness,
    proofPath,
    cleanup: () => {
      for (const directory of support.directories) {
        NodeFS.rmSync(directory, { force: true, recursive: true });
      }

      support.directories.clear();
    },
  };
}

describe("ProviderCommandReactor delegated approvals", () => {
  const testScope = createProviderCommandHarness();
  const { createHarness } = testScope;

  afterEach(testScope.dispose);

  it("resumes the delegated child's turn when its approval is answered, and the write lands", async () => {
    const { harness, proofPath, cleanup } = await stageDelegatedWrite(createHarness);

    // Parked, not running: nothing has been forwarded and nothing has been written yet.
    expect(harness.respondToRequest).not.toHaveBeenCalled();
    expect(NodeFS.existsSync(proofPath)).toBe(false);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-respond-delegated-child"),
        threadId: CHILD,
        requestId: asApprovalRequestId(REQUEST_ID),
        decision: "accept",
        createdAt: NOW,
      }),
    );

    await harness.drain();

    // The answer reaches the child's own session. Answering the parent instead would leave this
    // call unmade and the child blocked on a request nobody can still answer.
    expect(harness.respondToRequest.mock.calls).toHaveLength(1);
    expect(harness.respondToRequest.mock.calls[0]?.[0]).toEqual({
      threadId: String(CHILD),
      requestId: REQUEST_ID,
      decision: "accept",
    });

    expect(NodeFS.readFileSync(proofPath, "utf8")).toBe("delegated write");

    const thread = (await harness.readModel()).threads.find((entry) => entry.id === CHILD);

    expect(thread?.session).toMatchObject({ status: "running" });
    expect(thread?.activities ?? []).not.toContainEqual(
      expect.objectContaining({ kind: "provider.approval.respond.failed" }),
    );

    cleanup();
  });

  it("leaves the delegated child's write unrun when its approval is declined", async () => {
    const { harness, proofPath, cleanup } = await stageDelegatedWrite(createHarness);

    await harness.runEffect(
      harness.engine.dispatch({
        type: "thread.approval.respond",
        commandId: CommandId.make("cmd-approval-decline-delegated-child"),
        threadId: CHILD,
        requestId: asApprovalRequestId(REQUEST_ID),
        decision: "decline",
        createdAt: NOW,
      }),
    );

    await harness.drain();

    expect(harness.respondToRequest.mock.calls).toHaveLength(1);
    expect(harness.respondToRequest.mock.calls[0]?.[0]).toMatchObject({
      threadId: String(CHILD),
      decision: "decline",
    });
    expect(NodeFS.existsSync(proofPath)).toBe(false);

    cleanup();
  });
});
