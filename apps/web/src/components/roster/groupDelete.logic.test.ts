import { GroupId, WorkItemId, type WorkItemSummary } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { classifyGroupDeleteFailure, openWorkItemCountForGroup } from "./groupDelete.logic";

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
  // Pinned to the prose the decider writes, so a change to either message
  // surfaces here instead of degrading the toast to a generic error.
  it("recognises the open-work refusal from decider/groups.ts", () => {
    expect(
      classifyGroupDeleteFailure(
        "Group 'group-1' still holds 3 open work item(s). Pass discardWorkItems to delete it and discard them.",
      ),
    ).toBe("open-work-items");
  });

  it("recognises the rights refusal from commandInvariants.ts", () => {
    expect(
      classifyGroupDeleteFailure(
        "Person 'person-1' needs 'access:write' to change the environment.",
      ),
    ).toBe("environment-rights");
  });

  it("leaves anything else to the server's own wording", () => {
    expect(classifyGroupDeleteFailure("Group 'group-1' not found")).toBe("unknown");
    expect(classifyGroupDeleteFailure("")).toBe("unknown");
  });
});
