import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import { groupMemberRemovalHint, isGroupMemberRemovalBlocked } from "./GroupDetailsPanel";

/** The panel, its editor, and the removal rules, which together hold the panel's markup. */
function readGroupDetailsSources(): string {
  return ["./GroupDetailsPanel.tsx", "./GroupEditor.tsx", "./groupMemberRemoval.logic.ts"]
    .map((file) => NodeFS.readFileSync(new URL(file, import.meta.url), "utf8"))
    .join("\n");
}

describe("GroupDetailsPanel", () => {
  it("uses the bot sidebar behavior and group management commands", () => {
    const source = readGroupDetailsSources();
    expect(source).toContain('resolveShortcutCommand(event, keybindings) !== "rightPanel.toggle"');
    expect(source).toContain("RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY");
    expect(source).toContain("botEnvironment.groups.rename");
    expect(source).toContain("botEnvironment.groups.assignMember");
    expect(source).toContain("botEnvironment.groups.unassignMember");
    expect(source).toContain("botEnvironment.groups.setBoss");
    expect(source).toContain("botEnvironment.groups.delete");
    expect(source).toContain("input.memberCount <= 2");
    expect(source).not.toContain("Invite people");
    expect(source).toContain("dialogs.confirm(");
    expect(source).toContain(
      'confirmLabel: openWorkItemCount > 0 ? t("Delete and discard") : t("Delete group")',
    );
    expect(source).toContain("discardWorkItems: true");
    expect(source).toContain('variant="destructive-outline"');
  });

  it("explains why a bot cannot be removed yet", () => {
    expect(groupMemberRemovalHint({ memberCount: 2, bossName: "Mori", canAddBot: true })).toBe(
      "A group needs at least two bots. Add another bot before you remove one.",
    );
    expect(groupMemberRemovalHint({ memberCount: 2, bossName: "Mori", canAddBot: false })).toBe(
      "A group needs at least two bots. Create a new bot in the roster before you remove one.",
    );
    expect(groupMemberRemovalHint({ memberCount: 3, bossName: "Mori", canAddBot: true })).toBe(
      "To remove Mori, make another bot the boss first.",
    );
    expect(groupMemberRemovalHint({ memberCount: 3, bossName: null, canAddBot: true })).toBeNull();
  });

  it("links the removal hint only to rows it explains", () => {
    expect(isGroupMemberRemovalBlocked({ memberCount: 2, isBoss: false })).toBe(true);
    expect(isGroupMemberRemovalBlocked({ memberCount: 3, isBoss: true })).toBe(true);
    expect(isGroupMemberRemovalBlocked({ memberCount: 3, isBoss: false })).toBe(false);

    const source = readGroupDetailsSources();
    expect(source).toContain("aria-describedby={removalHint && blockedByRule ? removalHintId");
    expect(source).toContain('<SelectValue placeholder={t("Choose bot")} />');
    expect(source).toContain("Every bot is already in this group.");
  });

  // The toggle goes through the typed command, never a raw wire string, so a
  // rename of the command breaks the build here instead of at runtime.
  it("turns keep-busy on and off through the group command", () => {
    const source = readGroupDetailsSources();

    expect(source).toContain("botEnvironment.groups.setKeepBusy");
    expect(source).not.toContain("group.keep-busy");
    expect(source).toContain("aria-busy={busy}");
    expect(source).toContain("checked={groupKeepsBusy(group)}");
  });

  it("mounts beside the group conversation", () => {
    const source = NodeFS.readFileSync(
      new URL("../../routes/_chat.groups.$groupId.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<GroupThreadLanding");
    expect(source).toContain("<GroupDetailsPanel");
    expect(source).toContain("onDeleted=");
    expect(source).not.toContain("environmentPeopleAtom");
  });
});
