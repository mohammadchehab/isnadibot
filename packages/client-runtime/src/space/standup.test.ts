import { describe, expect, it } from "vite-plus/test";

import {
  BotId,
  GroupId,
  ThreadId,
  WorkItemId,
  type WorkItemBlockedOn,
  type WorkItemState,
} from "@isnadi/contracts";
import type { CapacityBot } from "../fleet/capacity.ts";
import type { SpaceGroup } from "./overview.ts";
import {
  STANDUP_QUEUE_LIMIT,
  spaceStandup,
  type StandupChat,
  type StandupWorkItem,
} from "./standup.ts";

const GROUP_ID = GroupId.make("g1");

const OTHER_GROUP_ID = GroupId.make("g2");

const BOSS = BotId.make("boss");

const ENGINEER = BotId.make("engineer");

const OUTSIDER = BotId.make("outsider");

const NOW = "2026-11-13T10:00:00.000Z";

const group: SpaceGroup = {
  id: GROUP_ID,
  bossBotId: BOSS,
  members: [{ kind: "bot", botId: BOSS }, { kind: "bot", botId: ENGINEER }, { kind: "person" }],
  updatedAt: NOW,
};

const ROSTER: ReadonlyArray<CapacityBot> = [
  { id: ENGINEER, name: "Engineer", archivedAt: null },
  { id: BOSS, name: "Boss", archivedAt: null },
  { id: OUTSIDER, name: "Outsider", archivedAt: null },
];

function chat(overrides: Partial<StandupChat> = {}): StandupChat {
  return {
    id: ThreadId.make("chat-1"),
    botId: ENGINEER,
    respondingBotId: null,
    parentThreadId: null,
    archivedAt: null,
    latestTurn: null,
    session: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    ...overrides,
  };
}

function item(
  id: string,
  state: WorkItemState,
  overrides: Partial<StandupWorkItem> = {},
): StandupWorkItem {
  return {
    id: WorkItemId.make(id),
    groupId: GROUP_ID,
    title: `Item ${id}`,
    state,
    createdAt: NOW,
    ...overrides,
  };
}

function report(
  input: {
    readonly chats?: ReadonlyArray<StandupChat>;
    readonly workItems?: ReadonlyArray<StandupWorkItem>;
  } = {},
) {
  return spaceStandup({
    group,
    bots: ROSTER,
    chats: input.chats ?? [],
    workItems: input.workItems ?? [],
    delegations: [],
  });
}

describe("spaceStandup", () => {
  it("scopes bots, chats and cards to this space", () => {
    const standup = report({
      chats: [
        chat({ id: ThreadId.make("mine"), botId: ENGINEER, hasPendingUserInput: true }),
        chat({ id: ThreadId.make("elsewhere"), botId: OUTSIDER, hasPendingUserInput: true }),
        chat({
          id: ThreadId.make("other-group"),
          botId: OUTSIDER,
          groupId: OTHER_GROUP_ID,
          hasPendingUserInput: true,
        }),
      ],
      workItems: [
        item("w-mine", "queued"),
        item("w-outsider", "queued", { groupId: OTHER_GROUP_ID, ownerBotId: OUTSIDER }),
        item("w-other-group", "queued", { groupId: OTHER_GROUP_ID }),
      ],
    });

    expect(standup.capacity.rows.map((row) => row.name)).toEqual(["Boss", "Engineer"]);
    expect(standup.capacity.counts).toEqual({ asking: 1, held: 0, busy: 0, idle: 1 });
    expect(standup.queue.map((entry) => entry.id)).toEqual(["w-mine"]);
    expect(standup.queueTotal).toBe(1);
  });

  it("leaves a card in another group off this space, even when a member holds it", () => {
    const standup = report({
      workItems: [item("w-member", "queued", { groupId: OTHER_GROUP_ID, ownerBotId: BOSS })],
    });

    expect(standup.queue).toEqual([]);
    expect(standup.queueTotal).toBe(0);
  });

  it("lists the queue oldest first, cuts it at five and counts the rest", () => {
    const workItems = ["w-6", "w-1", "w-5", "w-2", "w-4", "w-3"].map((id, index) =>
      item(id, "queued", { createdAt: `2026-11-0${index + 1}T10:00:00.000Z` }),
    );

    const standup = report({ workItems });

    expect(STANDUP_QUEUE_LIMIT).toBe(5);
    expect(standup.queue).toHaveLength(5);
    expect(standup.queueTotal).toBe(6);
    expect(standup.queue.map((entry) => entry.id)).toEqual(["w-6", "w-1", "w-5", "w-2", "w-4"]);
  });

  it("names the owner of a queued card, or leaves it null while nobody has it", () => {
    const standup = report({
      workItems: [
        item("w-taken", "assigned", {
          ownerBotId: ENGINEER,
          createdAt: "2026-11-01T10:00:00.000Z",
        }),
        item("w-free", "queued", { createdAt: "2026-11-02T10:00:00.000Z" }),
      ],
    });

    expect(standup.queue).toEqual([
      { id: "w-taken", title: "Item w-taken", ownerName: "Engineer" },
      { id: "w-free", title: "Item w-free", ownerName: null },
    ]);
  });

  it("reads a blocker as the user, a named bot, an unknown bot or nobody stated", () => {
    const blockedOn = (id: string, day: number, value?: WorkItemBlockedOn) =>
      item(id, "blocked", {
        createdAt: `2026-11-0${day}T10:00:00.000Z`,
        ...(value === undefined ? {} : { blockedOn: value }),
      });

    const standup = report({
      workItems: [
        blockedOn("w-user", 1, { by: "user", note: "Needs sign-in" }),
        blockedOn("w-bot", 2, { by: "bot", botId: ENGINEER, note: "Waiting on a review" }),
        blockedOn("w-gone", 3, {
          by: "bot",
          botId: BotId.make("deleted-bot"),
          note: "Waiting on it",
        }),
        blockedOn("w-unstated", 4),
      ],
    });

    expect(standup.blocked.map((entry) => entry.owner)).toEqual([
      { kind: "user" },
      { kind: "bot", name: "Engineer" },
      { kind: "bot", name: null },
      { kind: "unstated" },
    ]);
    expect(standup.blocked.map((entry) => entry.note)).toEqual([
      "Needs sign-in",
      "Waiting on a review",
      "Waiting on it",
      null,
    ]);
  });

  it("is quiet only when every bot is idle and nothing waits", () => {
    expect(report().isQuiet).toBe(true);
    expect(report({ workItems: [item("w-1", "queued")] }).isQuiet).toBe(false);
    expect(report({ chats: [chat({ latestTurn: null, hasPendingApprovals: true })] }).isQuiet).toBe(
      false,
    );
  });
});
