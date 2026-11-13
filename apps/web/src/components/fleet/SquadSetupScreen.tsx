import { FLEET_TEMPLATES, type FleetTemplate } from "@isnadi/contracts";
import { stepHopBudget } from "@isnadi/shared/groupHopBudget";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "lucide-react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Empty, EmptyHeader } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { HireMemberRow } from "./HireMemberRow";
import { useHireDraft } from "./useHireDraft";

/**
 * Screen 2 of the hire: the squad the chosen fleet creates, before it exists.
 * Every control edits the screen's draft; the draft never leaves it, so Back
 * drops the squad and Create (the next slice) is the only way one is created.
 */
export function SquadSetupScreen({ templateId }: { readonly templateId: string }) {
  const template = FLEET_TEMPLATES.find((candidate) => candidate.id === templateId) ?? null;

  if (template === null) return <FleetUnavailable />;

  return <SquadSetup template={template} />;
}

function FleetUnavailable() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/spaces/new" })}>
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

function SquadSetup({ template }: { readonly template: FleetTemplate }) {
  const { t } = useI18n();
  const navigate = useNavigate();

  const {
    draft,
    instanceEntries,
    modelOptionsByInstance,
    pickBoss,
    pickHopBudget,
    pickModel,
    pickReasoning,
  } = useHireDraft(template);

  const boss =
    draft.members.find((member) => member.roleId === draft.bossRoleId) ?? draft.members[0];

  const less = stepHopBudget(draft.hopBudget, -1);
  const more = stepHopBudget(draft.hopBudget, 1);

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <Button variant="ghost" size="sm" onClick={() => void navigate({ to: "/spaces/new" })}>
            <ArrowLeftIcon />
            {t("Back")}
          </Button>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{t(template.name)}</h1>
              <p className="text-sm text-muted-foreground">{t(template.description)}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("Boss")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("The bot that hands work out and answers for this space.")}
                </p>
              </div>
              <Select
                value={draft.bossRoleId}
                onValueChange={(next) => {
                  const member = draft.members.find((candidate) => candidate.roleId === next);

                  if (member) pickBoss(member.roleId);
                }}
              >
                <SelectTrigger aria-label={t("Boss")} className="w-full sm:w-56">
                  <SelectValue>{boss ? t(boss.name) : null}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {draft.members.map((member) => (
                    <SelectItem key={member.roleId} value={member.roleId}>
                      {t(member.name)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {draft.members.map((member) => (
                <HireMemberRow
                  key={member.roleId}
                  member={member}
                  instanceEntries={instanceEntries}
                  modelOptionsByInstance={modelOptionsByInstance}
                  onModelChange={(instanceId, model) => pickModel(member.roleId, instanceId, model)}
                  onReasoningChange={(options) => pickReasoning(member.roleId, options)}
                />
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("Reply budget")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("Bot replies one message can chain before the space stops.")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={t("Fewer replies")}
                  disabled={less === null}
                  onClick={() => less !== null && pickHopBudget(less)}
                >
                  <MinusIcon aria-hidden />
                </Button>
                <span className="text-sm" aria-live="polite" data-testid="hire-hop-budget">
                  {draft.hopBudget}
                </span>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={t("More replies")}
                  disabled={more === null}
                  onClick={() => more !== null && pickHopBudget(more)}
                >
                  <PlusIcon aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
