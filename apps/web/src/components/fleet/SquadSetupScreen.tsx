import { FLEET_TEMPLATES } from "@isnadi/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { planFleetHire } from "@isnadi/client-runtime/fleet/hire-plan";
import { useI18n } from "../../i18n";
import { primaryServerProvidersAtom } from "../../state/server";
import { BotAvatarView } from "../roster/BotAvatarView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyHeader } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

/**
 * Screen 2 of the hire: the squad the chosen fleet creates, before it exists.
 * This pass lists the members the plan seeds so the rest of the screen can be
 * wired to one plan; the model, reasoning and reply-budget controls and Create
 * land next.
 */
export function SquadSetupScreen({ templateId }: { readonly templateId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const template = FLEET_TEMPLATES.find((candidate) => candidate.id === templateId) ?? null;

  const back = () => void navigate({ to: "/spaces/new" });

  if (template === null) {
    return (
      <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkspacePageHeader className="border-b border-border">
            <Button variant="ghost" size="sm" onClick={back}>
              <ArrowLeftIcon />
              {t("Back")}
            </Button>
          </WorkspacePageHeader>
          <Empty>
            <EmptyHeader>{t("This fleet is no longer available.")}</EmptyHeader>
          </Empty>
        </div>
      </SidebarInset>
    );
  }

  const plan = planFleetHire({ template, providers });

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <Button variant="ghost" size="sm" onClick={back}>
            <ArrowLeftIcon />
            {t("Back")}
          </Button>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{t(template.name)}</h1>
              <p className="text-sm text-muted-foreground">{t(template.description)}</p>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {plan.members.map((member) => (
                <li key={member.roleId} className="flex items-center gap-3 px-4 py-3">
                  <BotAvatarView avatar={member.avatar} name={member.name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">{t(member.name)}</p>
                      {member.isBoss ? (
                        <Badge variant="secondary" size="sm">
                          {t("Boss")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{t(member.title)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
