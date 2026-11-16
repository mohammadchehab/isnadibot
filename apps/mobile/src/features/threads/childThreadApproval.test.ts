import { BotId, DelegationId, EnvironmentId, ThreadId, TurnId } from "@isnadi/contracts";
import type { ApprovalRequestId, IsnadiDelegationRecord } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { childApprovalCommand, delegationChildThreadRef } from "./childThreadApproval";

const delegation = (phase: IsnadiDelegationRecord["phase"]): IsnadiDelegationRecord => ({
  delegationId: DelegationId.make("d-1"),
  parentDelegationId: null,
  parentBotId: BotId.make("bot-parent"),
  childBotId: BotId.make("bot-child"),
  parentThreadId: ThreadId.make("thread-parent"),
  parentTurnId: TurnId.make("turn-1"),
  ancestorBotIds: [BotId.make("bot-parent")],
  depth: 1,
  task: "Compare three flights.",
  expectedResult: "A short comparison.",
  deadline: null,
  access: {
    allowedToolIds: [],
    memoryScopes: [],
    sandbox: null,
    runtimeMode: "approval-required",
    hasUserComputer: false,
    enabledMcpServerIds: [],
    disabledMcpServerIds: [],
    approvalCeiling: "none",
  },
  billedBotId: BotId.make("bot-child"),
  keep: false,
  anchorMessageId: null,
  retryOfDelegationId: null,
  trigger: "bot",
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
  phase,
});

const running = delegation({
  _tag: "Running",
  childThreadId: ThreadId.make("thread-child"),
  childTurnId: null,
  startedAt: "2026-09-25T10:00:30.000Z",
  progress: null,
});

const queued = delegation({ _tag: "Queued" });

const environmentId = EnvironmentId.make("env-1");

describe("delegationChildThreadRef", () => {
  it("names the delegated chat, not the chat that asked for the work", () => {
    expect(delegationChildThreadRef(environmentId, running)).toEqual({
      environmentId,
      threadId: "thread-child",
    });
  });

  it("has no chat to read while the delegation is still queued", () => {
    expect(delegationChildThreadRef(environmentId, queued)).toBeNull();
  });
});

describe("childApprovalCommand", () => {
  const requestId = "req-shell" as ApprovalRequestId;

  it("answers the delegated chat the approval was raised in", () => {
    const ref = delegationChildThreadRef(environmentId, running);
    expect(ref).not.toBeNull();

    expect(childApprovalCommand(ref!, requestId, "accept")).toEqual({
      environmentId,
      input: { threadId: "thread-child", requestId, decision: "accept" },
    });
  });

  it("keeps the decline decision and the request id it answers", () => {
    const ref = delegationChildThreadRef(environmentId, running);

    expect(childApprovalCommand(ref!, requestId, "decline").input).toEqual({
      threadId: "thread-child",
      requestId,
      decision: "decline",
    });
  });
});
