import * as NodeFS from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { BotId, GroupId, ThreadId } from "@isnadi/contracts";
import { createIsnadiToolRuntime } from "./IsnadiToolRuntime.ts";
import { isSameSpaceHandoffInSnapshot } from "./delegation/IsnadiDelegationPolicy.ts";
import { makeIsnadiToolRuntimeTestSupport } from "./test-support/IsnadiToolRuntime.ts";
import {
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "../orchestration/test-support/GroupDeciderFixtures.ts";

const { directories, workspace } = makeIsnadiToolRuntimeTestSupport();

const HOME = GroupId.make("group-home");

const OTHER_HOME = GroupId.make("group-other");

const THREAD = ThreadId.make("thread-group");

/** The boss of the space, hired into `HOME` like the mate it delegates to. */
const BOSS = BotId.make("bot-boss");

const MATE = BotId.make("bot-mate");

const OUTSIDER = BotId.make("bot-outsider");

/**
 * A boss addressing its squad mate by name — the natural thing an agent does,
 * since `TargetBotId` is "bot id or exact name" — has to reach the same answer
 * an ID would: recorded, not approved. These cases drive the real tool path
 * (`runtime.execute`) with the session wired exactly as `SessionLifecycle`
 * wires it, so the name travels through the same approval decision an ID does.
 */
describe("IsnadiToolRuntime same-space approval", () => {
  afterEach(() => {
    for (const directory of directories) {
      NodeFS.rmSync(directory, { force: true, recursive: true });
    }

    directories.clear();
  });

  const readModel = makeReadModel({
    bots: [
      { ...makeBot({ id: BOSS, groupId: HOME }), name: "Planner" },
      { ...makeBot({ id: MATE, groupId: HOME }), name: "Squad Mate" },
      { ...makeBot({ id: OUTSIDER, groupId: OTHER_HOME }), name: "Outsider" },
    ],
    groups: [
      makeGroup({
        members: [
          { kind: "bot", botId: BOSS, role: "boss" },
          { kind: "bot", botId: MATE, role: "specialist" },
          { kind: "bot", botId: OUTSIDER, role: "specialist" },
        ],
      }),
    ],
    threads: [makeGroupThread()],
  });

  const runtimeWithSend = () => {
    const send = vi.fn(async () => ({ delivered: true }));
    const runtime = createIsnadiToolRuntime();

    runtime.registerSession(THREAD, {
      botId: BOSS,
      runtimeMode: "approval-required",
      workspaceType: "local",
      workspace: workspace("same-space"),
      // The wiring `SessionLifecycle` supplies, minus the snapshot read.
      sameSpaceTarget: async (target) =>
        isSameSpaceHandoffInSnapshot(readModel, {
          threadId: THREAD,
          actingBotId: BOSS,
          targetBotId: target,
        }),
      delegation: {
        depth: 0,
        activeDelegations: 0,
        access: {
          allowedToolIds: ["SendToAgent"],
          memoryScopes: [],
          sandbox: "local",
          runtimeMode: "approval-required",
          hasUserComputer: false,
          enabledMcpServerIds: [],
          disabledMcpServerIds: [],
          approvalCeiling: "send",
        },
        send,
      },
    });

    return { runtime, send };
  };

  const execution = (target: string) => ({
    threadId: THREAD,
    toolId: "SendToAgent" as const,
    toolCallId: `tool-send-${target}`,
    input: {
      botId: BotId.make(target),
      task: "Build the todo list.",
      expectedResult: "A working list.",
    },
    approvalMode: "require-grant" as const,
  });

  it("records a handoff that names a squad mate instead of asking", async () => {
    const { runtime, send } = runtimeWithSend();

    await expect(runtime.execute(execution("Squad Mate"))).resolves.toEqual({ delivered: true });

    expect(send).toHaveBeenCalledOnce();
  });

  it("still asks for a handoff that names a bot outside the space", async () => {
    const { runtime, send } = runtimeWithSend();
    const outside = execution("Outsider");

    await expect(runtime.execute(outside)).rejects.toThrow("requires approval");

    runtime.grantApproval(outside);
    await expect(runtime.execute(outside)).resolves.toEqual({ delivered: true });

    expect(send).toHaveBeenCalledOnce();
  });

  it("still asks when the name matches no bot", async () => {
    const { runtime, send } = runtimeWithSend();

    await expect(runtime.execute(execution("Nobody Here"))).rejects.toThrow("requires approval");

    expect(send).not.toHaveBeenCalled();
  });
});
