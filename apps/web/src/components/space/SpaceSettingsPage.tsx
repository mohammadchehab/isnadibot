import { Predicate } from "effect";
import { BotId, GroupId, type EnvironmentId } from "@isnadi/contracts";
import { Link, useCanGoBack, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { isElectron } from "../../env";
import { useI18n } from "../../i18n";
import { botEnvironment } from "../../state/bots";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { SidebarInset } from "../ui/sidebar";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { groupKeepBusyCopy, groupKeepsBusy } from "../roster/groupKeepBusy.logic";
import { groupBotMembers } from "../roster/roster.logic";
import { useRosterStore } from "../roster/rosterStore";
import { spaceSettingsState } from "./spaceSettings.logic";

/**
 * The space's settings surface. It carries only the rows that have a setting
 * behind them today (Boss, Keep everyone busy); team rules land here as TASK-93
 * ships them, so the page is additive rather than rebuilt.
 */
export function SpaceSettingsPage({ groupId }: { readonly groupId: string }) {
  const { t, plural } = useI18n();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const environmentId = usePrimaryEnvironmentId();
  const setBoss = useAtomCommand(botEnvironment.groups.setBoss, { reportFailure: false });

  const setKeepBusy = useAtomCommand(botEnvironment.groups.setKeepBusy, {
    reportFailure: false,
  });

  const group = useRosterStore(
    (state) => state.groups.find((candidate) => candidate.id === groupId) ?? null,
  );

  const bots = useRosterStore((state) => state.bots);
  const [busy, setBusy] = useState(false);

  const members = group
    ? groupBotMembers(
        group,
        bots.filter((bot) => bot.archivedAt === null),
      )
    : [];

  const state = spaceSettingsState({ members, bossBotId: group?.bossBotId ?? null }, { t, plural });

  const keepBusyCopy = groupKeepBusyCopy(t);

  const navigateBackWithinApp = useCallback(() => {
    if (canGoBack) {
      window.history.back();

      return;
    }

    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      if (event.key !== "Escape") return;
      const activeElement = document.activeElement;

      // Let a focused field take Escape first; a second press leaves the page.
      if (activeElement instanceof HTMLElement && activeElement !== document.body) {
        activeElement.blur();

        return;
      }

      event.preventDefault();
      navigateBackWithinApp();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigateBackWithinApp]);

  const run = async (
    action: (environmentId: EnvironmentId) => Promise<{ readonly _tag: string }>,
    failure: string,
  ) => {
    if (!environmentId) return false;

    setBusy(true);
    const result = await action(environmentId);
    setBusy(false);

    if (Predicate.isTagged(result, "Failure")) {
      toastManager.add({ type: "error", title: failure });

      return false;
    }

    return true;
  };

  return (
    <SidebarInset
      tone="foreground"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border/70">
          <WorkspaceBreadcrumb ariaLabel={t("Space settings breadcrumb")}>
            <WorkspaceBreadcrumbItem className="min-w-0">
              {group ? (
                <Link
                  to="/groups/$groupId"
                  params={{ groupId }}
                  className="truncate hover:text-foreground"
                >
                  <bdi>{group.name}</bdi>
                </Link>
              ) : (
                t("Unavailable space")
              )}
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="shrink-0">
              {t("Settings")}
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        {group ? (
          <SettingsPageContainer>
            <div className="space-y-1">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                <bdi>{group.name}</bdi>
              </h1>
              <p className="text-sm text-muted-foreground">{state.statusLine}</p>
            </div>
            <SettingsSection title={t("Work")}>
              <SettingsRow
                title={t("Boss")}
                description={t("Answers every message by default and assigns the cards.")}
                status={state.bossHint}
                control={
                  <Select
                    value={group.bossBotId ?? ""}
                    disabled={state.bossDisabled || busy}
                    onValueChange={(botId) => {
                      if (!botId || botId === group.bossBotId) return;
                      void run(
                        (environmentId) =>
                          setBoss({
                            environmentId,
                            input: {
                              groupId: GroupId.make(group.id),
                              bossBotId: BotId.make(botId),
                              unassignPreviousBoss: false,
                            },
                          }),
                        t("Could not change group boss"),
                      );
                    }}
                  >
                    <SelectTrigger aria-label={t("Space boss")} className="w-full sm:w-44">
                      <SelectValue placeholder={state.bossPlaceholder}>
                        {state.bossName}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {members.map((bot) => (
                        <SelectItem key={bot.id} value={bot.id}>
                          {bot.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
              <SettingsRow
                title={keepBusyCopy.label}
                description={
                  <>
                    <p>{keepBusyCopy.hint}</p>
                    <p>{keepBusyCopy.offHint}</p>
                  </>
                }
                status={state.keepBusyHint}
                control={
                  <Switch
                    aria-label={keepBusyCopy.label}
                    aria-busy={busy}
                    checked={groupKeepsBusy(group)}
                    disabled={state.keepBusyDisabled || busy}
                    onCheckedChange={(checked) =>
                      void run(
                        (environmentId) =>
                          setKeepBusy({
                            environmentId,
                            input: {
                              groupId: GroupId.make(group.id),
                              keepBusy: checked,
                            },
                          }),
                        keepBusyCopy.failureTitle,
                      )
                    }
                  />
                }
              />
            </SettingsSection>
          </SettingsPageContainer>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            {t("This space is no longer available.")}
          </div>
        )}
      </div>
    </SidebarInset>
  );
}
