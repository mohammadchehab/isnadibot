import type { ReactNode } from "react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { GroupMemberStack } from "../roster/GroupMemberStack";
import { useGroupDetailsOpen } from "../roster/detailsPanelOpen";
import { useRosterStore } from "../roster/rosterStore";
import type { Group } from "../roster/types";
import { Empty, EmptyHeader } from "../ui/empty";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../ui/tabs";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { SpaceHeaderActionsHost } from "./spaceHeaderActions";
import { SpaceOverview } from "./SpaceOverview";

export const SPACE_TABS = ["overview", "chat", "skills", "files"] as const;

export type SpaceTab = (typeof SPACE_TABS)[number];

/**
 * The space's four tabs under one top bar carrying the space name. The chat tab keeps the
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
  const bots = useRosterStore((state) => state.bots);
  const [detailsPanelOpen] = useGroupDetailsOpen();
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
          <GroupMemberStack group={group} bots={bots} />
          <span className="truncate text-sm font-medium">
            <bdi>{group.name}</bdi>
          </span>
        </div>
        <TabsList aria-label={t("Space")} variant="top-bar">
          <TabsTab value="overview" variant="top-bar">
            {t("Overview")}
          </TabsTab>
          <TabsTab value="chat" variant="top-bar">
            {t("Group chat")}
          </TabsTab>
          <TabsTab value="skills" variant="top-bar">
            {t("Skills")}
          </TabsTab>
          <TabsTab value="files" variant="top-bar">
            {t("Files")}
          </TabsTab>
        </TabsList>
        <div
          ref={setActionsHost}
          data-space-header-actions=""
          className="ms-auto flex items-center"
        />
      </WorkspacePageHeader>
      <SpaceHeaderActionsHost.Provider value={actionsHost}>
        <TabsPanel value="overview">
          <SpaceOverview group={group} />
        </TabsPanel>
        <TabsPanel value="chat">{chat}</TabsPanel>
        <TabsPanel value="skills">
          <Empty>
            <EmptyHeader>{t("Skills for this space show here.")}</EmptyHeader>
          </Empty>
        </TabsPanel>
        <TabsPanel value="files">
          <Empty>
            <EmptyHeader>{t("Files you add to this space show here.")}</EmptyHeader>
          </Empty>
        </TabsPanel>
      </SpaceHeaderActionsHost.Provider>
    </Tabs>
  );
}
