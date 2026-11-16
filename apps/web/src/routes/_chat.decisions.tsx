import { createFileRoute } from "@tanstack/react-router";

import { DecisionsGroup } from "../components/roster/DecisionsGroup";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useI18n } from "../i18n";

/**
 * The sidebar's Decisions row lands here. The page is the roster's Decisions
 * group lifted whole — same rows, same actions — so the two surfaces cannot
 * drift while the drawn page frame (TASK-424) is still missing.
 */
function DecisionsRouteView() {
  const { t } = useI18n();

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <span className="text-sm font-medium text-muted-foreground">{t("Decisions")}</span>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <div className="mx-auto w-full max-w-3xl px-4">
            <DecisionsGroup />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/decisions")({
  component: DecisionsRouteView,
});
