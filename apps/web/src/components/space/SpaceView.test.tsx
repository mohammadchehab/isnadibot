import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Group } from "../roster/types";

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (message: string) => message }) }));

vi.mock("./SpaceOverview", () => ({ SpaceOverview: () => <p>overview-body</p> }));

vi.mock("./SpaceTasks", () => ({ SpaceTasks: () => <p>tasks-body</p> }));

import { SpaceView, type SpaceTab } from "./SpaceView";

const group: Group = {
  id: "g1",
  name: "Launch",
  bossBotId: null,
  members: [],
  createdAt: "2026-11-06T10:00:00.000Z",
  updatedAt: "2026-11-06T10:00:00.000Z",
};

function render(tab: SpaceTab) {
  return renderToStaticMarkup(
    <SpaceView group={group} tab={tab} onTabChange={vi.fn()} chat={<p>chat-body</p>} />,
  );
}

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
});
