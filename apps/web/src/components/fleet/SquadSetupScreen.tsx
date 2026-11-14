import { FLEET_TEMPLATES, type FleetTemplate } from "@isnadi/contracts";
import type { FleetHireBlocker } from "@isnadi/client-runtime/fleet/hire-plan";
import { stepHopBudget } from "@isnadi/shared/groupHopBudget";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Empty, EmptyHeader } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { HireMemberRow } from "./HireMemberRow";
import { useCreateSquad } from "./useCreateSquad";
import { useHireDraft } from "./useHireDraft";

/**
 * Why Create is off, in the words the user can act on. The first blocker is
 * the one the footer names; the rest stay in the list behind it.
 */
function BlockerNotice({ blocker }: { readonly blocker: FleetHireBlocker }) {
  const { t } = useI18n();

  switch (blocker.kind) {
    case "no-provider":
      return t("No provider can run this bot yet.");
    case "empty-name":
      return t("Every bot needs a name.");
    case "duplicate-name":
      return t("Two bots share that name");
  }
}

/**
 * Screen 2 of the hire: the squad the chosen fleet creates, before it exists.
 * Every control edits the screen's draft; the draft never leaves it, so Back
 * drops the squad and Create is the only way one is created.
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
    blockers,
    locked,
    instanceEntries,
    modelOptionsByInstance,
    pickBoss,
    pickHopBudget,
    pickModel,
    pickReasoning,
    recordFailure,
  } = useHireDraft(template);

  const { create, pending } = useCreateSquad();
  const [creating, setCreating] = useState(false);

  const boss =
    draft.members.find((member) => member.roleId === draft.bossRoleId) ?? draft.members[0];

  const less = stepHopBudget(draft.hopBudget, -1);
  const more = stepHopBudget(draft.hopBudget, 1);
  const blocker = blockers[0];

  // A send that went out owns the draft until it answers: while it is in flight,
  // and while its outcome is unknown, nothing on screen may change what it sent.
  const busy = creating || pending;
  const frozen = busy || locked;

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
                disabled={frozen}
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
                  disabled={frozen}
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
                  disabled={frozen || less === null}
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
                  disabled={frozen || more === null}
                  onClick={() => more !== null && pickHopBudget(more)}
                >
                  <PlusIcon aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
          <p className="min-w-0 text-xs text-muted-foreground" aria-live="polite">
            {locked ? (
              t("Checking what happened…")
            ) : blocker ? (
              <BlockerNotice blocker={blocker} />
            ) : null}
          </p>
          <Button
            // While the outcome is unknown the send may still land, so Create
            // stays live: pressing it asks the server the same question again.
            disabled={busy || blocker !== undefined}
            onClick={() => {
              if (busy) return;

              setCreating(true);
              void create(draft, recordFailure).finally(() => setCreating(false));
            }}
          >
            {t("Create")}
          </Button>
        </div>
      </div>
    </SidebarInset>
  );
}
