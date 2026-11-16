import { createFileRoute } from "@tanstack/react-router";

import { CHATS_COLUMN_CLASS, ChatsPage, ChatsPageSkeleton } from "../components/chats/ChatsPage";
import { PageTopBar } from "../components/PageTopBar";
import { SidebarInset } from "../components/ui/sidebar";
import { useI18n } from "../i18n";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";

/**
 * The sidebar's Chats row lands here: one row per bot or space with a live
 * conversation. Rows wait for the shell snapshot, so the page never flashes an
 * empty state over chats that are still arriving.
 */
function ChatsRouteView() {
  const { t } = useI18n();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageTopBar title={t("Chats")} />
        <div className="min-h-0 flex-1 overflow-y-auto pt-6 pb-4">
          <div className={CHATS_COLUMN_CLASS}>
            {bootstrapped ? <ChatsPage /> : <ChatsPageSkeleton />}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/chats")({
  component: ChatsRouteView,
});
