import {
  BotId,
  EnvironmentId,
  EventId,
  type OrchestrationThreadActivity,
  TurnId,
} from "@isnadi/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { makeShellSnapshot } from "../test-support/fixtures";
import type { Group } from "../roster/types";

/**
 * The Team table reads the shell snapshot for the rows and each bot's newest chat
 * for the context reading. These fixtures stand in for both, so a test can put a
 * reading on one bot and prove it lands on that bot's row alone.
 */

const ENVIRONMENT = EnvironmentId.make("environment-1");

const BOSS = BotId.make("bot-boss");

const ENGINEER = BotId.make("bot-engineer");

const mocks = vi.hoisted(() => ({
  snapshot: null as ReturnType<typeof makeShellSnapshot> | null,
  activitiesByThreadId: new Map<string, ReadonlyArray<OrchestrationThreadActivity>>(),
  openDetails: vi.fn(),
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (message: string, values?: Record<string, string | number>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        message,
      ),
  }),
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => ENVIRONMENT }));

vi.mock("../../state/environmentSnapshot", () => ({
  useEnvironmentSnapshot: () => mocks.snapshot,
}));

vi.mock("../../state/entities", () => ({
  useThreadActivities: (ref: { threadId: string } | null) =>
    ref === null ? [] : (mocks.activitiesByThreadId.get(ref.threadId) ?? []),
}));

vi.mock("../roster/detailsPanelOpen", () => ({
  useGroupDetailsOpen: () => [false, mocks.openDetails],
}));

import { SpaceTeamTable } from "./SpaceTeamTable";

const group: Group = {
  id: "group-fleet",
  name: "Launch",
  bossBotId: "bot-boss",
  members: [
    { kind: "bot", botId: BOSS, role: "boss" },
    { kind: "bot", botId: ENGINEER, role: "specialist" },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const render = () => renderToStaticMarkup(<SpaceTeamTable group={group} />);

beforeEach(() => {
  mocks.activitiesByThreadId.clear();
  mocks.snapshot = makeShellSnapshot({
    bots: [
      { id: "bot-boss", name: "Leo bot" },
      { id: "bot-engineer", name: "Engineer" },
    ],
    threads: [
      {
        id: "chat-engineer",
        botId: "bot-engineer",
        groupId: "group-fleet",
        updatedAt: "2026-11-13T11:00:00.000Z",
        latestTurn: {
          turnId: "turn-1",
          state: "running",
          requestedAt: "2026-11-13T10:59:00.000Z",
          startedAt: "2026-11-13T11:00:00.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      },
    ],
    workItems: [
      {
        id: "item-1",
        groupId: "group-fleet",
        title: "Wire the team table",
        kind: "task",
        briefPreview: "",
        state: "in-progress",
        ownerBotId: "bot-engineer",
        createdAt: "2026-11-13T09:00:00.000Z",
        updatedAt: "2026-11-13T09:00:00.000Z",
      },
    ],
  });
});

describe("space team table", () => {
  it("gives each member a row with its state, its item and its own context reading", () => {
    const contextActivity: OrchestrationThreadActivity = {
      id: EventId.make("activity-1"),
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      payload: { usedTokens: 21_000, maxTokens: 100_000 },
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-11-13T11:00:00.000Z",
    };

    mocks.activitiesByThreadId.set("chat-engineer", [contextActivity]);

    const markup = render();

    for (const header of ["Bot", "Status", "Working on", "Context"]) {
      expect(markup).toContain(`>${header}</th>`);
    }

    expect(markup).toContain("Leo bot");
    expect(markup).toContain("Boss");
    expect(markup).toContain("Busy");
    expect(markup).toContain("Wire the team table");
    // The frames draw the reading as a size, not a percentage.
    expect(markup).toContain("21k of 100k");

    // The boss has no chat and no item, so it reads as two em dashes and no number.
    expect(markup).not.toContain("0k of");
  });
});
