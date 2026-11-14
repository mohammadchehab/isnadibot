import { GroupId, WorkItemId, type WorkItemSummary } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { classifyGroupDeleteFailure, openWorkItemCountForGroup } from "./groupDelete.logic";

/** Anything a failure's cause can squash to, so each case below reads on its own. */
type SquashedFailure = Error | Record<string, string> | string | null | undefined;

const failed = (error: SquashedFailure) => ({ cause: Cause.fail(error) });

function summary(id: string, overrides: Partial<WorkItemSummary> = {}): WorkItemSummary {
  return {
    id: WorkItemId.make(id),
    groupId: GroupId.make("group-1"),
    title: `Item ${id}`,
    briefPreview: "",
    kind: "task",
    state: "queued",
    createdAt: "2026-11-13T08:00:00.000Z",
    updatedAt: "2026-11-13T08:00:00.000Z",
    ...overrides,
  };
}

describe("openWorkItemCountForGroup", () => {
  it("counts only this group's items that are still open", () => {
    const items = [
      summary("a"),
      summary("b", { state: "in-progress" }),
      summary("c", { state: "blocked" }),
      summary("d", { state: "review" }),
      summary("e", { state: "done" }),
      summary("f", { state: "closed" }),
      summary("g", { groupId: GroupId.make("group-2") }),
    ];

    expect(openWorkItemCountForGroup(items, "group-1")).toBe(4);
    expect(openWorkItemCountForGroup(items, "group-2")).toBe(1);
    expect(openWorkItemCountForGroup(items, "group-3")).toBe(0);
    expect(openWorkItemCountForGroup([], "group-1")).toBe(0);
  });
});

describe("classifyGroupDeleteFailure", () => {
  // The server attaches the code at the throw site, so these cases assert the
  // discriminant and never the sentence: a copyedit of either message must not
  // reach this test.
  it("reads the open-work refusal code", () => {
    expect(classifyGroupDeleteFailure(failed({ refusal: "open-work-items" }))).toBe(
      "open-work-items",
    );
  });

  it("reads the environment-rights refusal code", () => {
    expect(classifyGroupDeleteFailure(failed({ refusal: "environment-rights" }))).toBe(
      "environment-rights",
    );
  });

  it("leaves anything else to the server's own wording", () => {
    // A code a newer server added, and a failure with no code at all: both fall
    // back so the caller shows the prose the server sent.
    expect(classifyGroupDeleteFailure(failed({ refusal: "group-not-found" }))).toBe("unknown");
    expect(classifyGroupDeleteFailure(failed({ message: "Group 'group-1' not found" }))).toBe(
      "unknown",
    );
    expect(classifyGroupDeleteFailure(failed(new Error("Boom")))).toBe("unknown");
    expect(classifyGroupDeleteFailure(failed(undefined))).toBe("unknown");
    expect(classifyGroupDeleteFailure(failed(null))).toBe("unknown");
    expect(classifyGroupDeleteFailure(failed("open-work-items"))).toBe("unknown");
  });
});
