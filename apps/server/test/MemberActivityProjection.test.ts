import * as Schema from "effect/Schema";
import {
  EventId,
  MEMBER_ACTIVITY_DATA_FIELDS,
  MEMBER_ACTIVITY_ITEM_FIELDS,
  MEMBER_ACTIVITY_PAYLOAD_FIELDS,
  MEMBER_APPROVAL_REQUESTED_SUMMARY,
  MEMBER_APPROVAL_RESOLVED_SUMMARY,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
} from "@isnadi/contracts";
import * as Predicate from "effect/Predicate";
import { describe, expect, it } from "vite-plus/test";

import { derivePendingRequests } from "../../../packages/client-runtime/src/pendingRequests.ts";
import {
  projectActivityEvent,
  projectActivityPayload,
  projectThreadDetailSnapshot,
} from "../src/orchestration/ActivityPayloadProjection.ts";

const OWNER_HOME = "/Users/owner/projects/isnadi";

function makeActivity(
  id: string,
  kind: string,
  payload: Schema.JsonObject,
  summary: string,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: kind.startsWith("approval") ? "approval" : "tool",
    kind,
    summary,
    payload,
    turnId: TurnId.make("turn-member"),
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

/** A command turn exactly as `ActivityMapping` persists it. */
const commandTurn = makeActivity(
  "command",
  "tool.started",
  {
    itemType: "command_execution",
    toolCallId: "tool-command",
    status: "inProgress",
    detail: `bash -lc "cat ${OWNER_HOME}/.env"`,
    data: {
      command: `bash -lc "cat ${OWNER_HOME}/.env"`,
      item: {
        command: ["bash", "-lc", `cat ${OWNER_HOME}/.env`],
        aggregatedOutput: "OPENAI_API_KEY=sk-live-owner-secret",
      },
      args: { command: "cat .env" },
      rawOutput: { content: "OPENAI_API_KEY=sk-live-owner-secret" },
    },
  },
  "Bash started",
);

/** A file-change turn: absolute paths from `collectChangedFiles`. */
const fileChangeTurn = makeActivity(
  "file-change",
  "tool.updated",
  {
    itemType: "file_change",
    toolCallId: "tool-files",
    status: "inProgress",
    data: {
      item: { command: ["apply_patch"], changes: [{ path: `${OWNER_HOME}/src/new.ts` }] },
      files: [{ path: `${OWNER_HOME}/src/new.ts` }, { path: `${OWNER_HOME}/src/old.ts` }],
    },
  },
  "Patch started",
);

/** The owner's pending approval, whose args arrive from the provider runtime. */
const commandApproval = makeActivity(
  "approval",
  "approval.requested",
  {
    requestId: "tool-command",
    requestKind: "command",
    requestType: "command_execution_approval",
    toolName: "Bash",
    action: `cat ${OWNER_HOME}/.env`,
    detail: `bash -lc "cat ${OWNER_HOME}/.env"`,
    options: [{ kind: "allow_once", label: "Yes" }],
  },
  "Command approval requested",
);

/** A product-feedback approval: `args` is a decoded structure, not a command. */
const feedbackApproval = makeActivity(
  "feedback",
  "approval.requested",
  {
    requestId: "req-feedback",
    requestKind: "mcp-elicitation",
    requestType: "mcp_tool_approval",
    toolName: "isnadi_product_feedback",
    args: { rating: 5, message: `the panel at ${OWNER_HOME} is broken`, draft: { path: "x" } },
    detail: "Product feedback",
  },
  "App access approval requested",
);

const approvalResolved = makeActivity(
  "resolved",
  "approval.resolved",
  {
    requestId: "req-feedback",
    requestKind: "mcp-elicitation",
    requestType: "mcp_tool_approval",
    decision: "approve",
    action: `write ${OWNER_HOME}/notes.md`,
    outcome: "allow",
  },
  "Approval resolved",
);

const fixtures = [
  commandTurn,
  fileChangeTurn,
  commandApproval,
  feedbackApproval,
  approvalResolved,
] satisfies ReadonlyArray<OrchestrationThreadActivity>;

/** Nothing the owner's machine says may reach a member's frame. */
function expectNoOwnerWork(text: string) {
  for (const secret of [
    "bash",
    "cat ",
    OWNER_HOME,
    "/Users/",
    "sk-live-owner-secret",
    "allow_once",
  ]) {
    expect(text).not.toContain(secret);
  }

  for (const field of ["args", "detail", "toolName", "requestKind", "requestType", "action"]) {
    expect(text).not.toContain(`"${field}"`);
  }
}

describe("member activity projection", () => {
  it("serializes a command turn with no command line, args or output", () => {
    const member = projectActivityPayload(commandTurn, "member");

    expect(member.payload).toEqual({
      itemType: "command_execution",
      status: "inProgress",
      toolCallId: "tool-command",
    });
    expect(member.summary).toBe("Bash started");
    expectNoOwnerWork(JSON.stringify(member));
  });

  it("serializes a file-change turn with no absolute paths", () => {
    const member = projectActivityPayload(fileChangeTurn, "member");

    expect(member.payload).toEqual({
      itemType: "file_change",
      status: "inProgress",
      toolCallId: "tool-files",
    });
    expectNoOwnerWork(JSON.stringify(member));
  });

  it("keeps a tool item's status, which the member's row renders", () => {
    const completed = makeActivity(
      "completed",
      "tool.completed",
      {
        itemType: "command_execution",
        toolCallId: "tool-command",
        status: "failed",
        data: { item: { command: ["bash", "-lc", "pwd"], status: "failed" } },
      },
      "Bash completed",
    );

    expect(projectActivityPayload(completed, "member").payload).toEqual({
      itemType: "command_execution",
      status: "failed",
      toolCallId: "tool-command",
    });
  });

  it("carries no args, detail or tool name on the owner's pending approval", () => {
    const member = projectActivityPayload(commandApproval, "member");

    expect(member.payload).toEqual({ requestId: "tool-command" });
    expect(member.summary).toBe(MEMBER_APPROVAL_REQUESTED_SUMMARY);
    expectNoOwnerWork(JSON.stringify(member));
  });

  it("drops a decoded product-feedback or routine approval's structures", () => {
    const member = projectActivityPayload(feedbackApproval, "member");

    expect(member.payload).toEqual({ requestId: "req-feedback" });
    expectNoOwnerWork(JSON.stringify(member));
  });

  it("replaces a resolved approval's summary and keeps only its request id", () => {
    const member = projectActivityPayload(approvalResolved, "member");

    expect(member.payload).toEqual({ requestId: "req-feedback" });
    expect(member.summary).toBe(MEMBER_APPROVAL_RESOLVED_SUMMARY);
    expectNoOwnerWork(JSON.stringify(member));
  });

  it("leaves the pending approval card empty once derivePendingRequests merges it", () => {
    const memberFrames = fixtures.map((activity) => projectActivityPayload(activity, "member"));
    const { approvals } = derivePendingRequests(memberFrames);

    expect(approvals.map((approval) => approval.requestId)).toEqual(["tool-command"]);
    // The command reaches the card from `tool.started` at pendingRequests.ts:160,
    // so the assertion is on the merged record, not on approval.requested alone.
    expect(approvals[0]).not.toHaveProperty("args");
    expect(approvals[0]).not.toHaveProperty("detail");
    expect(approvals[0]).not.toHaveProperty("toolName");
    expectNoOwnerWork(JSON.stringify(memberFrames));

    const card = JSON.stringify(approvals[0]);

    for (const secret of ["bash", "cat ", OWNER_HOME, "/Users/", "sk-live-owner-secret"]) {
      expect(card).not.toContain(secret);
    }
  });

  it("carries no answer controls: a member cannot act on the owner's approval", () => {
    const memberFrames = fixtures.map((activity) => projectActivityPayload(activity, "member"));
    const { approvals } = derivePendingRequests(memberFrames);

    expect(approvals[0]?.options).toBeUndefined();
  });

  it("keeps every projected payload field inside the contracts allowlist", () => {
    const payloadFields: ReadonlyArray<string> = MEMBER_ACTIVITY_PAYLOAD_FIELDS;
    const dataFields: ReadonlyArray<string> = MEMBER_ACTIVITY_DATA_FIELDS;
    const itemFields: ReadonlyArray<string> = MEMBER_ACTIVITY_ITEM_FIELDS;

    for (const activity of fixtures) {
      const payload = projectActivityPayload(activity, "member").payload;

      if (!Predicate.isObject(payload)) {
        throw new Error(`a member payload must stay an object: ${JSON.stringify(payload)}`);
      }

      for (const key of Object.keys(payload)) {
        expect(payloadFields).toContain(key);
      }

      const data = payload.data;

      if (!Predicate.isObject(data)) continue;

      for (const key of Object.keys(data)) {
        expect(dataFields).toContain(key);
      }

      const item = data.item;

      if (!Predicate.isObject(item)) continue;

      for (const key of Object.keys(item)) {
        expect(itemFields).toContain(key);
      }
    }
  });

  it("leaves the owner's frame byte-identical to today", () => {
    for (const activity of fixtures) {
      expect(JSON.stringify(projectActivityPayload(activity, "owner"))).toBe(
        JSON.stringify(projectActivityPayload(activity)),
      );
    }

    expect(projectActivityPayload(commandTurn).payload).toMatchObject({
      itemType: "command_execution",
      detail: `bash -lc "cat ${OWNER_HOME}/.env"`,
      data: {
        item: { command: ["bash", "-lc", `cat ${OWNER_HOME}/.env`] },
        command: `bash -lc "cat ${OWNER_HOME}/.env"`,
        rawOutput: { content: "OPENAI_API_KEY=sk-live-owner-secret" },
      },
    });
  });

  it("projects the snapshot route once for every activity a member receives", () => {
    const snapshot = projectThreadDetailSnapshot(
      { snapshotSequence: 1, thread: makeThread(fixtures) },
      "member",
    );

    expect(snapshot.thread.activities).toHaveLength(fixtures.length);
    expectNoOwnerWork(JSON.stringify(snapshot));
  });

  it("projects the live event route without mutating the shared event", () => {
    const event: OrchestrationEvent = {
      type: "thread.activity-appended",
      eventId: EventId.make("event-member"),
      threadId: ThreadId.make("thread-member"),
      sequence: 1,
      createdAt: "2026-07-27T00:00:00.000Z",
      payload: {
        threadId: ThreadId.make("thread-member"),
        activity: commandTurn,
      },
    } as OrchestrationEvent;

    const memberEvent = projectActivityEvent(event, "member");
    const ownerEvent = projectActivityEvent(event);

    expectNoOwnerWork(JSON.stringify(memberEvent));
    expect(ownerEvent).not.toBe(memberEvent);
    expect(JSON.stringify(ownerEvent)).toContain(OWNER_HOME);
    expect(JSON.stringify(event)).toContain(OWNER_HOME);
  });
});

function makeThread(activities: ReadonlyArray<OrchestrationThreadActivity>): OrchestrationThread {
  return {
    id: ThreadId.make("thread-member"),
    projectId: ProjectId.make("project-member"),
    title: "Member thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities,
    checkpoints: [],
    session: null,
  };
}
