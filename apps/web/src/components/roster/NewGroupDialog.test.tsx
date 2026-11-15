import { createTranslator } from "@isnadi/client-runtime/i18n";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  canCreateGroup,
  groupSelectionHint,
  isBotOfferable,
  NewGroupDialog,
} from "./NewGroupDialog";
import type { Bot, Group } from "./types";

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: createTranslator("en").translate }),
}));

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (children: ReactNode) => children,
}));

// Dialogs mount their popups after hydration, so render them inline when open.
vi.mock("../ui/dialog", async (importOriginal) => {
  const Pass = ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>;

  return {
    ...(await importOriginal<typeof import("../ui/dialog")>()),
    Dialog: ({ open, children }: { readonly open: boolean; readonly children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogDescription: Pass,
    DialogFooter: Pass,
    DialogHeader: Pass,
    DialogPanel: Pass,
    DialogPopup: Pass,
    DialogTitle: Pass,
  };
});

function makeBot(id: string, name: string, groupId: string | null = null): Bot {
  return {
    id,
    name,
    title: "Generalist",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    avatar: { kind: "blob", shape: "circle", color: "#5B7FD4" },
    engine: null,
    sandbox: null,
    runtimeMode: "full-access",
    voiceEnabled: false,
    groupId,
    pinned: false,
    archivedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

function makeGroup(id: string): Group {
  return {
    id,
    name: "Research",
    bossBotId: null,
    members: [],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
}

const HOME_GROUP = makeGroup("group-home");

const groupless = makeBot("bot-groupless", "Groupless");

const grouped = makeBot("bot-grouped", "Grouped", HOME_GROUP.id);

describe("new group", () => {
  it("requires a name, two distinct bots, and a selected boss", () => {
    expect(canCreateGroup("Launch crew", ["one", "two"], "one")).toBe(true);
    expect(canCreateGroup("Launch crew", ["one"], "one")).toBe(false);
    expect(canCreateGroup("Launch crew", ["one", "one"], "one")).toBe(false);
    expect(canCreateGroup(" ", ["one", "two"], "one")).toBe(false);
    expect(canCreateGroup("Launch crew", ["one", "two"], "three")).toBe(false);
  });
});

describe("group selection hint", () => {
  it("asks for two bots until two distinct bots are selected", () => {
    expect(groupSelectionHint([])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one"])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one", "one"])).toBe("Select at least two bots.");
    expect(groupSelectionHint(["one", "two"])).toBeNull();
  });
});

describe("isBotOfferable", () => {
  it("offers a bot with no home and one whose home group is gone", () => {
    expect(isBotOfferable(groupless, [HOME_GROUP])).toBe(true);
    expect(isBotOfferable(grouped, [])).toBe(true);
  });

  it("hides a bot whose home group still exists", () => {
    expect(isBotOfferable(grouped, [HOME_GROUP])).toBe(false);
  });

  it("hides an archived bot even when it has no home", () => {
    expect(isBotOfferable({ ...groupless, archivedAt: "2026-08-27T00:00:00.000Z" }, [])).toBe(
      false,
    );
  });
});

describe("new group dialog", () => {
  const render = (bots: readonly Bot[], groups: readonly Group[]) =>
    renderToStaticMarkup(
      <NewGroupDialog
        open
        bots={bots}
        groups={groups}
        onOpenChange={() => {}}
        onCreate={() => {}}
      />,
    );

  it("lists a groupless bot and leaves out one whose home group is live", () => {
    const markup = render([groupless, grouped], [HOME_GROUP]);

    expect(markup).toContain("Groupless");
    // The create would be refused for this bot, so it is not offered at all.
    expect(markup).not.toContain("Grouped");
  });

  it("offers that bot again once its home group is deleted", () => {
    const markup = render([groupless, grouped], []);

    expect(markup).toContain("Groupless");
    expect(markup).toContain("Grouped");
  });
});
