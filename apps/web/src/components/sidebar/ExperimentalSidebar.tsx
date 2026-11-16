import type { Decision } from "@isnadi/client-runtime/decisions";
import { spaceMembers } from "@isnadi/client-runtime/space";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  BotIcon,
  Clock3Icon,
  FolderIcon,
  MessagesSquareIcon,
  PanelLeftIcon,
  PuzzleIcon,
  SettingsIcon,
  UsersIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { APP_DISPLAY_NAME } from "../../branding";
import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { openPlugins } from "../../pluginsDialogStore";
import { openSettings } from "../../settingsDialogStore";
import { useDecisions } from "../../state/entities";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { BotAvatarView } from "../roster/BotAvatarView";
import { useRosterStore } from "../roster/rosterStore";
import { SidebarGroupLabel, SidebarMenuBadge, SidebarMenuButton, useSidebar } from "../ui/sidebar";

/**
 * Frame 2088:817: one 248 column of 32px rows — header, the nav group, a Spaces
 * group, a Bots group, and Settings pinned at the bottom. Every row is an
 * instance of a design-system primitive the frame names, so the geometry comes
 * from those and not from local styles.
 *
 * Decision-82 adds the Decisions row and its count badge; the frame draws no
 * Decisions row. Decision-92 keeps the Chats row, which opens the
 * all-conversations page while that page is still being drawn.
 */
const SIDEBAR_WIDTH = 248;

const STORAGE_KEY = "isnadi:sidebar-experiment";

const EXPERIMENT = "places";

export const EXPERIMENTAL_SIDEBAR_WIDTH = SIDEBAR_WIDTH;

function isPathUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

function readExperiment(): boolean {
  const param = new URLSearchParams(window.location.search).get("sidebar");

  if (param !== null) window.localStorage.setItem(STORAGE_KEY, param);

  return (window.localStorage.getItem(STORAGE_KEY) ?? EXPERIMENT) === EXPERIMENT;
}

/** Resolved once per page load; switching layouts is a reload. */
export function useSidebarExperiment(): boolean {
  const [enabled] = useState(readExperiment);

  return enabled;
}

export function ExperimentalSidebar() {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const { t } = useI18n();
  const { toggleSidebar } = useSidebar();
  const decisions = useDecisions(usePrimaryEnvironmentId());

  const onSettings = isPathUnder(pathname, "/settings");
  const onPlugins = isPathUnder(pathname, "/plugins");
  const onRoutines = isPathUnder(pathname, "/routines");
  const onDecisions = isPathUnder(pathname, "/decisions");
  const onChats = !onSettings && !onPlugins && !onRoutines && !onDecisions;

  const { groups, bots } = useRosterStore(
    useShallow((state) => ({ groups: state.groups, bots: state.bots })),
  );

  const liveBots = useMemo(() => bots.filter((bot) => bot.archivedAt === null), [bots]);

  // A bot belongs to at most one space, so the Bots group lists the loose ones.
  // The frame cannot say this; it is the only reading that keeps the two groups
  // disjoint and stops a hired fleet's bots appearing twice.
  const spaceBotIds = useMemo(
    () => new Set(groups.flatMap((group) => [...spaceMembers(group)])),
    [groups],
  );

  const looseBots = useMemo(
    () => liveBots.filter((bot) => !spaceBotIds.has(bot.id)),
    [liveBots, spaceBotIds],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* The macOS traffic lights sit over the sidebar, so they get a strip
          above the header while they show. */}
      <div
        className={cn(
          "hidden h-(--workspace-topbar-height) w-full shrink-0 in-data-[macos-traffic-lights]:block",
          isElectron && "drag-region",
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto bg-sidebar p-3">
        <SidebarTitleRow label={t("Collapse sidebar")} onToggle={toggleSidebar} />

        <nav aria-label={t("Main")} className="flex flex-col gap-1">
          <SidebarMenuButton isActive={onChats} onClick={() => void navigate({ to: "/" })}>
            <MessagesSquareIcon />
            <span>{t("Chats")}</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            isActive={onRoutines}
            onClick={() => void navigate({ to: "/routines" })}
          >
            <Clock3Icon />
            <span>{t("Routines")}</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            isActive={onPlugins}
            onClick={() => {
              if (!onPlugins) openPlugins();
            }}
          >
            <PuzzleIcon />
            <span>{t("Plugins")}</span>
          </SidebarMenuButton>
          <SidebarMenuButton
            isActive={onDecisions}
            onClick={() => void navigate({ to: "/decisions" })}
          >
            <UsersIcon />
            <span>{t("Decisions")}</span>
            {decisions.length > 0 ? (
              <SidebarMenuBadge>{decisionCount(decisions)}</SidebarMenuBadge>
            ) : null}
          </SidebarMenuButton>

          {groups.length > 0 ? (
            <>
              <SidebarGroupLabel>{t("Spaces")}</SidebarGroupLabel>
              {groups.map((group) => (
                <SidebarMenuButton
                  isActive={pathname === `/groups/${group.id}`}
                  key={group.id}
                  onClick={() =>
                    void navigate({ to: "/groups/$groupId", params: { groupId: group.id } })
                  }
                >
                  <FolderIcon />
                  <span>{group.name}</span>
                  <SidebarMenuBadge>{spaceMembers(group).size}</SidebarMenuBadge>
                </SidebarMenuButton>
              ))}
            </>
          ) : null}

          {looseBots.length > 0 ? (
            <>
              <SidebarGroupLabel>{t("Bots")}</SidebarGroupLabel>
              {looseBots.map((bot) => (
                <SidebarMenuButton
                  isActive={pathname === `/bots/${bot.id}`}
                  key={bot.id}
                  onClick={() => void navigate({ to: "/bots/$botId", params: { botId: bot.id } })}
                >
                  <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-7" />
                  <span>{bot.name}</span>
                </SidebarMenuButton>
              ))}
            </>
          ) : null}
        </nav>
      </div>
      <div className="shrink-0 bg-sidebar p-3 pt-0">
        <SidebarMenuButton
          isActive={onSettings}
          onClick={() => {
            if (!onSettings) openSettings();
          }}
        >
          <SettingsIcon />
          <span>{t("Settings")}</span>
        </SidebarMenuButton>
      </div>
    </div>
  );
}

/** The badge caps at 99+ so a long queue cannot widen the row. */
function decisionCount(decisions: ReadonlyArray<Decision>): string {
  return decisions.length > 99 ? "99+" : String(decisions.length);
}

function SidebarTitleRow({ label, onToggle }: { label: string; onToggle: () => void }) {
  return (
    <div className={cn("flex w-full shrink-0 items-center gap-2 p-2", isElectron && "drag-region")}>
      <BotIcon className="size-4 shrink-0 text-sidebar-foreground" />
      <span className="truncate font-semibold text-15px text-sidebar-foreground leading-5 tracking-title-sm">
        {APP_DISPLAY_NAME}
      </span>
      <span className="h-px min-w-px flex-1" />
      <button
        aria-label={label}
        className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-sm text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onToggle}
        type="button"
      >
        <PanelLeftIcon className="size-4" />
      </button>
    </div>
  );
}
