import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSkillRegistry } from "@isnadi/client-runtime/skills";
import { MoreHorizontalIcon } from "lucide-react";

import { useI18n } from "../../i18n";
import { GroupMemberStack } from "../roster/GroupMemberStack";
import { useGroupDetailsOpen } from "../roster/detailsPanelOpen";
import { useRosterStore } from "../roster/rosterStore";
import type { Group } from "../roster/types";
import { SkillRegistryPage } from "../skills/SkillRegistryPage";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyHeader } from "../ui/empty";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SpaceHeaderActionsHost } from "./spaceHeaderActions";
import { SpaceOverview } from "./SpaceOverview";
import { SpaceTasks } from "./SpaceTasks";

export const SPACE_TABS = ["overview", "tasks", "chat", "skills", "files"] as const;

export type SpaceTab = (typeof SPACE_TABS)[number];

/**
 * The space's five tabs under one top bar carrying the space name. The chat tab keeps the
 * existing group chat; the tab lives in the URL.
 */
export function SpaceView({
  group,
  tab,
  onTabChange,
  chat,
}: {
  group: Group;
  tab: SpaceTab;
  onTabChange: (tab: SpaceTab) => void;
  chat: ReactNode;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bots = useRosterStore((state) => state.bots);
  // No registry source means no Skills tab, the way a shipped build has no registry at all.
  const skillsAvailable = useSkillRegistry().state !== "unavailable";
  const [detailsPanelOpen] = useGroupDetailsOpen();
  // A space a bot made says so. The creator is resolved by id so a deleted bot still
  // labels the space, falling back to the house wording the refusal copy already uses.
  const creatorBot = bots.find((bot) => bot.id === group.createdByBotId);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = SPACE_TABS.find((candidate) => candidate === value);

        if (next) onTabChange(next);
      }}
    >
      <WorkspacePageHeader className="border-b border-border" detailsPanelOpen={detailsPanelOpen}>
        <div className="flex min-w-0 items-center gap-2">
          {/* Only the Group chat header draws the member stack; every other space tab is
              name then tabs, so the stack never lands on a tab label. */}
          {tab === "chat" ? <GroupMemberStack group={group} bots={bots} /> : null}
          <span className="min-w-0 truncate text-sm font-medium">
            <bdi>{group.name}</bdi>
          </span>
          {group.createdByBotId ? (
            <Badge size="sm" variant="outline">
              {creatorBot ? t("Made by {name}", { name: creatorBot.name }) : t("Made by a bot")}
            </Badge>
          ) : null}
        </div>
        <TabsList aria-label={t("Space")} variant="top-bar">
          <TabsTab value="overview" variant="top-bar">
            {t("Overview")}
          </TabsTab>
          <TabsTab value="tasks" variant="top-bar">
            {t("Tasks")}
          </TabsTab>
          <TabsTab value="chat" variant="top-bar">
            {t("Group chat")}
          </TabsTab>
          {/* A platform with no skill registry source has no Skills tab, the way a shipped
              build has no registry at all. */}
          {skillsAvailable ? (
            <TabsTab value="skills" variant="top-bar">
              {t("Skills")}
            </TabsTab>
          ) : null}
          <TabsTab value="files" variant="top-bar">
            {t("Files")}
          </TabsTab>
        </TabsList>
        <div className="ms-auto flex items-center">
          <div ref={setActionsHost} data-space-header-actions="" className="flex items-center" />
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost-muted"
                  aria-label={t("Space actions")}
                >
                  <MoreHorizontalIcon aria-hidden />
                </Button>
              }
            />
            <MenuPopup align="end" className="min-w-40">
              <MenuItem
                onClick={() =>
                  void navigate({
                    to: "/groups/$groupId/settings",
                    params: { groupId: group.id },
                  })
                }
              >
                {t("Space settings")}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </WorkspacePageHeader>
      <SpaceHeaderActionsHost.Provider value={actionsHost}>
        <TabsPanel value="overview">
          <SpaceOverview group={group} />
        </TabsPanel>
        <TabsPanel value="tasks">
          <SpaceTasks group={group} />
        </TabsPanel>
        <TabsPanel value="chat">{chat}</TabsPanel>
        {skillsAvailable ? (
          <TabsPanel value="skills">
            {/* A space carries no project id yet, so the list is not narrowed to one. The
                space→project link lands with the registry itself in phase 1. */}
            <SkillRegistryPage className="overflow-y-auto p-4" />
          </TabsPanel>
        ) : null}
        <TabsPanel value="files">
          <Empty>
            <EmptyHeader>{t("Files you add to this space show here.")}</EmptyHeader>
          </Empty>
        </TabsPanel>
      </SpaceHeaderActionsHost.Provider>
    </Tabs>
  );
}
