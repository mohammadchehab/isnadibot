import { renderToStaticMarkup } from "react-dom/server";
import { registerSkillRegistrySource } from "@isnadi/client-runtime/skills";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";

const mocks = vi.hoisted(() => ({ bots: [] as ReadonlyArray<Bot> }));

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

vi.mock("../roster/rosterStore", () => ({
  useRosterStore: (selector: (state: { bots: ReadonlyArray<Bot> }) => ReadonlyArray<Bot>) =>
    selector({ bots: mocks.bots }),
}));

vi.mock("./SpaceOverview", () => ({ SpaceOverview: () => <p>overview-body</p> }));

vi.mock("./SpaceTasks", () => ({ SpaceTasks: () => <p>tasks-body</p> }));

vi.mock("../roster/GroupMemberStack", () => ({
  GroupMemberStack: () => <span data-testid="member-stack" />,
}));

import { SpaceView, type SpaceTab } from "./SpaceView";

const scout: Bot = {
  id: "bot-1",
  name: "Scout",
  title: "Researcher",
  label: null,
  description: null,
  disabledMcpServerIds: [],
  avatar: { kind: "blob", shape: "circle", color: "#2E8EFF" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: "g1",
  pinned: false,
  archivedAt: null,
  createdAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:00.000Z",
};

const group: Group = {
  id: "g1",
  name: "Launch",
  bossBotId: null,
  members: [],
  createdAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:00.000Z",
};

const botMade: Group = { ...group, createdByBotId: "bot-1" };

function render(tab: SpaceTab, subject: Group = group) {
  return renderToStaticMarkup(
    <SpaceView group={subject} tab={tab} onTabChange={vi.fn()} chat={<p>chat-body</p>} />,
  );
}

beforeEach(() => {
  mocks.bots = [scout];
  // A platform with a registry source, the way web and desktop register one.
  registerSkillRegistrySource({
    subscribe: () => () => undefined,
    getSnapshot: () => ({ state: "ready", skills: [], unavailableConnectors: [] }),
  });
});

afterEach(() => {
  registerSkillRegistrySource(null);
});

describe("SpaceView", () => {
  it("carries the space name and the tabs in one top bar", () => {
    const html = render("overview");

    expect(html).toContain("Launch");
    expect(html.indexOf("Launch")).toBeLessThan(html.indexOf("overview-body"));
  });

  it("lists the five tabs", () => {
    const html = render("chat");

    for (const label of ["Overview", "Tasks", "Group chat", "Skills", "Files"])
      expect(html).toContain(label);
  });

  it("shows only the selected tab's panel", () => {
    expect(render("chat")).toContain("chat-body");
    expect(render("chat")).not.toContain("overview-body");
    expect(render("chat")).not.toContain("tasks-body");
    expect(render("overview")).toContain("overview-body");
    expect(render("overview")).not.toContain("chat-body");
    expect(render("tasks")).toContain("tasks-body");
    expect(render("tasks")).not.toContain("overview-body");
  });

  it("shows an empty state on Files", () => {
    expect(render("files")).toContain("Files you add to this space show here.");
  });

  it("draws the member stack only on Group chat, where the header owns it", () => {
    expect(render("chat")).toContain("member-stack");

    for (const tab of ["overview", "tasks", "skills", "files"] as const)
      expect(render(tab)).not.toContain("member-stack");
  });

  it("keeps the space name in the top bar on every tab", () => {
    for (const tab of ["overview", "tasks", "chat", "skills", "files"] as const)
      expect(render(tab)).toContain("Launch");
  });

  it("draws no made-by label on a space a person made", () => {
    for (const tab of ["overview", "tasks", "chat", "skills", "files"] as const)
      expect(render(tab)).not.toContain("Made by");
  });

  it("names the bot that made the space, using the Badge primitive", () => {
    const html = render("overview", botMade);

    expect(html).toContain("Made by Scout");
    expect(html).toContain('data-slot="badge"');
    // The label follows the space name in the identity row, not the other way round.
    expect(html.indexOf("Launch")).toBeLessThan(html.indexOf("Made by Scout"));
  });

  it("falls back to the house wording when the creator is gone", () => {
    mocks.bots = [];

    const html = render("overview", botMade);

    expect(html).toContain("Made by a bot");
    expect(html).not.toContain("Made by Scout");
  });

  it("keeps the made-by label on every tab", () => {
    for (const tab of ["overview", "tasks", "chat", "skills", "files"] as const)
      expect(render(tab, botMade)).toContain("Made by Scout");
  });
});
