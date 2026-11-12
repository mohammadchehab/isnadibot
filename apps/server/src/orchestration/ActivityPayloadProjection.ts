import type { ActivityValue, ActivityRecord } from "./ActivityPayloadBounds.ts";
import * as Predicate from "effect/Predicate";
import type {
  OrchestrationEvent,
  OrchestrationThreadActivity,
  OrchestrationThreadDetailSnapshot,
} from "@isnadi/contracts";
import {
  IsnadiPluginSearchResult,
  MEMBER_ACTIVITY_DATA_FIELDS,
  MEMBER_ACTIVITY_ITEM_FIELDS,
  MEMBER_ACTIVITY_PAYLOAD_FIELDS,
  MEMBER_APPROVAL_REQUESTED_SUMMARY,
  MEMBER_APPROVAL_RESOLVED_SUMMARY,
} from "@isnadi/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { asRecord, asTrimmedString, projectBoundedValue } from "./ActivityPayloadBounds.ts";
import {
  summarizeToolTextOutput,
  projectCommandData,
  projectCommandValue,
  collectChangedFiles,
} from "./CommandActivityPayload.ts";
import { projectMcpToolCallData } from "./McpActivityPayload.ts";
import {
  dropSupersededToolUpdatedActivities,
  dropStaleContextWindowActivities,
} from "./ActivityRetention.ts";

const decodePluginSearchResult = Schema.decodeUnknownOption(IsnadiPluginSearchResult);

/**
 * Task-list tools (Isnadi's `task_write`, Claude's `TodoWrite`) carry the whole
 * list in their args. Clients only show the step in progress, as a short status.
 */
function projectMemoryOperationCount(data: ActivityRecord): number | undefined {
  const operations = asRecord(data.args)?.operations;

  return Array.isArray(operations) ? operations.length : undefined;
}

function projectRawOutput(value: ActivityValue): ActivityRecord | undefined {
  const direct = asTrimmedString(value);

  if (direct) {
    const summary = summarizeToolTextOutput(direct);

    return summary ? { content: summary } : undefined;
  }

  const rawOutput = asRecord(value);

  if (!rawOutput) {
    return undefined;
  }

  if (Predicate.isNumber(rawOutput.totalFiles) && Number.isFinite(rawOutput.totalFiles)) {
    return {
      totalFiles: rawOutput.totalFiles,
      ...(rawOutput.truncated === true ? { truncated: true } : {}),
    };
  }

  const content = asTrimmedString(rawOutput.content);

  if (content) {
    const summary = summarizeToolTextOutput(content);

    return summary ? { content: summary } : undefined;
  }

  const stdout = asTrimmedString(rawOutput.stdout);

  if (stdout) {
    const summary = summarizeToolTextOutput(stdout);

    return summary ? { content: summary } : undefined;
  }

  const stderr = asTrimmedString(rawOutput.stderr);

  if (stderr) {
    const summary = summarizeToolTextOutput(stderr);

    return summary ? { content: summary } : undefined;
  }

  return undefined;
}

function projectAcpContent(value: ActivityValue): ActivityRecord | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const text = value
    .map((entryValue) => {
      const entry = asRecord(entryValue);
      const content = asRecord(entry?.content);

      return entry?.type === "content" && content?.type === "text"
        ? asTrimmedString(content.text)
        : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join("\n");

  const summary = summarizeToolTextOutput(text);

  return summary ? { content: summary } : undefined;
}

function projectPluginSearchResult(value: ActivityValue): IsnadiPluginSearchResult | undefined {
  const decoded = decodePluginSearchResult(value);

  if (Option.isNone(decoded)) return undefined;

  return {
    ...decoded.value,
    recommendations: decoded.value.recommendations.slice(0, 6),
  };
}

/**
 * Removes activity payload fields that no current client reads while retaining
 * the full payload in persistence and the event store.
 */
function projectPayloadForOwner(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const payload = asRecord(activity.payload);
  const data = asRecord(payload?.data);

  if (!payload || !data) {
    return activity;
  }

  const itemStatus = asRecord(data.item)?.status;

  const projectedPayload =
    payload.status === "completed" && (itemStatus === "failed" || itemStatus === "declined")
      ? { ...payload, status: itemStatus }
      : payload;

  if (payload.itemType === "mcp_tool_call") {
    return {
      ...activity,
      payload: {
        ...projectedPayload,
        data: projectMcpToolCallData(data),
      },
    };
  }

  if (payload.itemType === "dynamic_tool_call" && activity.summary === "SearchPlugins") {
    const result = projectPluginSearchResult(data.result);

    if (result) {
      return {
        ...activity,
        payload: {
          ...projectedPayload,
          data: {
            result,
            ...(data.toolCallId !== undefined ? { toolCallId: data.toolCallId } : {}),
          },
        },
      };
    }
  }

  const projectedData: ActivityRecord = {};
  const item = projectCommandData(data);

  if (item) {
    projectedData.item = item;
  }

  const command = projectCommandValue(data);

  if (command !== undefined) {
    projectedData.command = projectBoundedValue(command);
  }

  const changedFiles: string[] = [];
  collectChangedFiles(data, changedFiles, new Set<string>(), 0);

  if (changedFiles.length > 0) {
    // Both clients discover file names by walking objects with path-like keys.
    projectedData.files = changedFiles.map((path) => ({ path }));
  }

  if ("toolCallId" in data) {
    projectedData.toolCallId = data.toolCallId;
  }

  if ("kind" in data) {
    projectedData.kind = data.kind;
  }

  const memoryOperationCount = projectMemoryOperationCount(data);

  if (memoryOperationCount !== undefined) {
    projectedData.memoryOperationCount = memoryOperationCount;
  }

  const rawOutput = projectRawOutput(data.rawOutput) ?? projectAcpContent(data.content);

  if (rawOutput) {
    projectedData.rawOutput = rawOutput;
  }

  return {
    ...activity,
    payload: {
      ...projectedPayload,
      data: projectedData,
    },
  };
}

/**
 * Who the frame is for. Activities describe the owner's work on the owner's
 * machine: a member reads the conversation, never the command line, the changed
 * paths, the tool output or the owner's approval arguments. Redacting here, at
 * the one seam every surface projects through, is what makes that fail-closed —
 * a screen cannot hide what its socket already sent.
 */
export type ActivityViewer = "owner" | "member";

function pickFields(record: ActivityRecord, fields: ReadonlyArray<string>): ActivityRecord {
  const picked: ActivityRecord = {};

  for (const field of fields) {
    if (record[field] !== undefined) {
      picked[field] = record[field];
    }
  }

  return picked;
}

function memberActivitySummary(kind: string, summary: string): string {
  if (kind === "approval.requested") {
    return MEMBER_APPROVAL_REQUESTED_SUMMARY;
  }

  if (kind === "approval.resolved") {
    return MEMBER_APPROVAL_RESOLVED_SUMMARY;
  }

  return summary;
}

/**
 * The owner's activity reduced to the contracts allowlist
 * (`MEMBER_ACTIVITY_PAYLOAD_FIELDS`). Nothing here names a field to hide: a
 * field added to an activity later is absent for a member until contracts
 * allows it, which is what keeps a new leak from shipping by default.
 */
function projectPayloadForMember(
  activity: OrchestrationThreadActivity,
): OrchestrationThreadActivity {
  const projected: OrchestrationThreadActivity = {
    ...activity,
    summary: memberActivitySummary(activity.kind, activity.summary),
  };

  const payload = asRecord(activity.payload);

  if (!payload) {
    return projected;
  }

  const memberPayload = pickFields(payload, MEMBER_ACTIVITY_PAYLOAD_FIELDS);
  // `data` is a container: it is rebuilt from the nested allowlist below and
  // never copied across, so a field the nested allowlist drops cannot ride
  // along inside the owner's `data` object.
  delete memberPayload.data;
  const data = asRecord(payload.data);

  if (data) {
    const memberData = pickFields(data, MEMBER_ACTIVITY_DATA_FIELDS);
    const item = asRecord(memberData.item);

    if (item) {
      const memberItem = pickFields(item, MEMBER_ACTIVITY_ITEM_FIELDS);

      if (Object.keys(memberItem).length > 0) {
        memberData.item = memberItem;
      } else {
        delete memberData.item;
      }
    }

    if (Object.keys(memberData).length > 0) {
      memberPayload.data = memberData;
    }
  }

  return { ...projected, payload: memberPayload };
}

export function projectActivityPayload(
  activity: OrchestrationThreadActivity,
  viewer: ActivityViewer = "owner",
): OrchestrationThreadActivity {
  const projected = projectPayloadForOwner(activity);

  return viewer === "member" ? projectPayloadForMember(projected) : projected;
}

export function projectThreadDetailSnapshot(
  snapshot: OrchestrationThreadDetailSnapshot,
  viewer: ActivityViewer = "owner",
): OrchestrationThreadDetailSnapshot {
  return {
    ...snapshot,
    thread: {
      ...snapshot.thread,
      activities: dropSupersededToolUpdatedActivities(
        dropStaleContextWindowActivities(snapshot.thread.activities),
      ).map((activity) => projectActivityPayload(activity, viewer)),
    },
  };
}

// Published events are immutable and shared by every live subscriber. Project
// each one once so subscribers share the projected object, which also lets the
// live stream budget reuse its serialized-size measurement. One cache per
// viewer: the owner's frame and a member's frame are different objects.
const projectedActivityEvents: Record<
  ActivityViewer,
  WeakMap<OrchestrationEvent, OrchestrationEvent>
> = {
  owner: new WeakMap(),
  member: new WeakMap(),
};

export function projectActivityEvent(
  event: OrchestrationEvent,
  viewer: ActivityViewer = "owner",
): OrchestrationEvent {
  if (event.type !== "thread.activity-appended") {
    return event;
  }

  const cache = projectedActivityEvents[viewer];
  const cached = cache.get(event);

  if (cached !== undefined) {
    return cached;
  }

  const projected: OrchestrationEvent = {
    ...event,
    payload: {
      ...event.payload,
      activity: projectActivityPayload(event.payload.activity, viewer),
    },
  };

  cache.set(event, projected);
  // Mark the result as already projected so a repeat call returns it unchanged.
  cache.set(projected, projected);

  return projected;
}
