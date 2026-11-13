import type { WorkItemState, WorkItemSummary } from "@isnadi/contracts";

export type WorkItemColumn = "new" | "in-progress" | "draft" | "closed" | "done";

/** The board's columns, left to right: New, In progress, Draft, Closed, Done. */
export const WORK_ITEM_BOARD_COLUMNS: ReadonlyArray<WorkItemColumn> = [
  "new",
  "in-progress",
  "draft",
  "closed",
  "done",
];

/** The board column a work item shows in. Blocked items stay in In progress with a badge. */
export function workItemColumn(state: WorkItemState): WorkItemColumn {
  switch (state) {
    case "queued":
    case "assigned":
      return "new";
    case "in-progress":
    case "blocked":
      return "in-progress";
    case "review":
      return "draft";
    case "done":
      return "done";
    case "closed":
      return "closed";
  }
}

/**
 * The fields the board needs from an item. Both the open summaries the shell
 * carries and the full items the finished read returns satisfy it.
 */
export type BoardItem = Pick<WorkItemSummary, "id" | "state" | "updatedAt">;

export type WorkItemBoard<T extends BoardItem = WorkItemSummary> = Readonly<
  Record<WorkItemColumn, ReadonlyArray<T>>
>;

/** True when the item is still queued, assigned, in progress, blocked or in review. */
export function isOpenWorkItem(state: WorkItemState): boolean {
  return state !== "done" && state !== "closed";
}

/** Sorts newest first, then by id so two items saved in the same instant keep a stable order. */
const newestFirst = (left: BoardItem, right: BoardItem) =>
  right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);

/**
 * Groups items into the five board columns, each sorted newest first.
 *
 * The shell carries open items only, so `done` and `closed` fill from the paged
 * `workItems.list` read. An item that arrives in both lists is kept once, in the
 * open copy, until the finished list catches up.
 */
export function workItemBoard<T extends BoardItem>(items: Iterable<T>): WorkItemBoard<T> {
  const seen = new Set<string>();

  const columns: Record<WorkItemColumn, T[]> = {
    new: [],
    "in-progress": [],
    draft: [],
    closed: [],
    done: [],
  };

  for (const item of items) {
    if (seen.has(item.id)) continue;

    seen.add(item.id);
    columns[workItemColumn(item.state)].push(item);
  }

  for (const column of WORK_ITEM_BOARD_COLUMNS) columns[column].sort(newestFirst);

  return columns;
}

/**
 * The edit controls an item allows, mirroring the server decider so the board
 * never offers a move the server will reject.
 *
 * - A `queued` item has no owner yet, so it must be assigned before it can move.
 * - `update` only accepts a progress state from an assigned, in-progress, review
 *   or blocked item.
 * - A finished item accepts nothing but `reopen`.
 */
export interface WorkItemActions {
  readonly canAssign: boolean;
  readonly canEdit: boolean;
  readonly canStart: boolean;
  readonly canReview: boolean;
  readonly canClose: boolean;
  readonly canReopen: boolean;
}

const PROGRESS_SOURCES: ReadonlySet<WorkItemState> = new Set([
  "assigned",
  "in-progress",
  "review",
  "blocked",
]);

export function workItemActions(state: WorkItemState): WorkItemActions {
  const open = isOpenWorkItem(state);
  const movable = PROGRESS_SOURCES.has(state);

  return {
    canAssign: open,
    canEdit: open,
    canStart: movable && state !== "in-progress",
    canReview: movable && state !== "review",
    canClose: open,
    canReopen: !open,
  };
}
