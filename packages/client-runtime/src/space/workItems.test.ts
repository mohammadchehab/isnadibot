import { GroupId, WorkItemId, type WorkItemState, type WorkItemSummary } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  WORK_ITEM_BOARD_COLUMNS,
  isOpenWorkItem,
  workItemActions,
  workItemBoard,
  workItemColumn,
} from "./workItems.ts";

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

describe("workItemColumn", () => {
  it("maps every state to its board column", () => {
    expect(workItemColumn("queued")).toBe("new");
    expect(workItemColumn("assigned")).toBe("new");
    expect(workItemColumn("in-progress")).toBe("in-progress");
    expect(workItemColumn("blocked")).toBe("in-progress");
    expect(workItemColumn("review")).toBe("draft");
    expect(workItemColumn("done")).toBe("done");
    expect(workItemColumn("closed")).toBe("closed");
  });
});

describe("isOpenWorkItem", () => {
  it("calls every state but done and closed open", () => {
    const states: ReadonlyArray<WorkItemState> = [
      "queued",
      "assigned",
      "in-progress",
      "blocked",
      "review",
      "done",
      "closed",
    ];

    expect(states.filter(isOpenWorkItem)).toEqual([
      "queued",
      "assigned",
      "in-progress",
      "blocked",
      "review",
    ]);
  });
});

describe("workItemBoard", () => {
  it("gives every column a list, even when nothing lands in it", () => {
    const board = workItemBoard([]);

    expect(Object.keys(board)).toEqual([...WORK_ITEM_BOARD_COLUMNS]);

    for (const column of WORK_ITEM_BOARD_COLUMNS) expect(board[column]).toEqual([]);
  });

  it("puts each item in its column", () => {
    const board = workItemBoard([
      summary("queued", { state: "queued" }),
      summary("assigned", { state: "assigned" }),
      summary("working", { state: "in-progress" }),
      summary("stuck", { state: "blocked" }),
      summary("reviewing", { state: "review" }),
      summary("finished", { state: "done" }),
      summary("dropped", { state: "closed" }),
    ]);

    const ids = (column: keyof typeof board) => board[column].map((item) => item.id).toSorted();

    expect(ids("new")).toEqual(["assigned", "queued"]);
    expect(ids("in-progress")).toEqual(["stuck", "working"]);
    expect(board["draft"].map((item) => item.id)).toEqual(["reviewing"]);
    expect(board.done.map((item) => item.id)).toEqual(["finished"]);
    expect(board.closed.map((item) => item.id)).toEqual(["dropped"]);
  });

  it("sorts each column newest first", () => {
    const board = workItemBoard([
      summary("old", { updatedAt: "2026-11-12T08:00:00.000Z" }),
      summary("new", { updatedAt: "2026-11-13T09:00:00.000Z" }),
      summary("middle", { updatedAt: "2026-11-13T08:00:00.000Z" }),
    ]);

    expect(board["new"].map((item) => item.id)).toEqual(["new", "middle", "old"]);
  });

  it("keeps one copy of an item that the open and finished reads both carry", () => {
    const working = summary("moved", { state: "assigned" });
    const stale = summary("moved", { state: "done", doneAt: "2026-11-13T09:00:00.000Z" });

    const board = workItemBoard([working, stale]);

    expect(board["new"].map((item) => item.id)).toEqual(["moved"]);
    expect(board.done).toEqual([]);
  });
});

describe("workItemActions", () => {
  const cases: ReadonlyArray<
    [WorkItemState, { start: boolean; review: boolean; close: boolean; reopen: boolean }]
  > = [
    ["queued", { start: false, review: false, close: true, reopen: false }],
    ["assigned", { start: true, review: true, close: true, reopen: false }],
    ["in-progress", { start: false, review: true, close: true, reopen: false }],
    ["blocked", { start: true, review: true, close: true, reopen: false }],
    ["review", { start: true, review: false, close: true, reopen: false }],
    ["done", { start: false, review: false, close: false, reopen: true }],
    ["closed", { start: false, review: false, close: false, reopen: true }],
  ];

  it.each(cases)("offers the moves the decider allows from %s", (state, expected) => {
    const actions = workItemActions(state);

    expect(actions.canStart).toBe(expected.start);
    expect(actions.canReview).toBe(expected.review);
    expect(actions.canClose).toBe(expected.close);
    expect(actions.canReopen).toBe(expected.reopen);
  });

  it("only lets an open item be edited or assigned", () => {
    for (const state of ["queued", "assigned", "in-progress", "blocked", "review"] as const) {
      expect(workItemActions(state)).toMatchObject({ canEdit: true, canAssign: true });
    }

    for (const state of ["done", "closed"] as const) {
      expect(workItemActions(state)).toMatchObject({ canEdit: false, canAssign: false });
    }
  });
});
