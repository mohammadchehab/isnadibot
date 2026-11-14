import {
  FLEET_TEMPLATES,
  fleetRole,
  type FleetTemplate,
  type FleetTemplateId,
} from "@isnadi/contracts";
import { useAtomValue } from "@effect/atom-react";
import { planFleetHire, type FleetHirePlan } from "@isnadi/client-runtime/fleet/hire-plan";
import { useNavigate } from "@tanstack/react-router";
import {
  FileTextIcon,
  FlaskConicalIcon,
  MessagesSquareIcon,
  PlayIcon,
  TerminalIcon,
  UserPlusIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useI18n } from "../../i18n";
import { primaryServerProvidersAtom } from "../../state/server";
import { BotAvatarView } from "../roster/BotAvatarView";
import { NewGroupDialog } from "../roster/NewGroupDialog";
import { useRosterStore } from "../roster/rosterStore";
import { useCreateGroup } from "../roster/useCreateGroup";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

/** The template art the contracts name, drawn with the app's icon set. */
const TEMPLATE_ICONS: Record<FleetTemplate["icon"], LucideIcon> = {
  "user-plus": UserPlusIcon,
  play: PlayIcon,
  terminal: TerminalIcon,
  "flask-conical": FlaskConicalIcon,
  "messages-square": MessagesSquareIcon,
  "file-text": FileTextIcon,
};

/** What a card can show before it starts dropping members for a count. */
const CARD_MEMBER_SLOTS = 4;

/**
 * Screen 1 of the hire: the fleet the user wants, or an empty space. The card is
 * the whole choice — the squad's names, models and reply budget belong to squad
 * setup, so nothing here previews or edits them.
 *
 * The card previews the plan, not the template's roles, so the order the user
 * sees here is the order squad setup and the hire use.
 */
export function StartSpaceScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bots = useRosterStore((state) => state.bots);
  const providers = useAtomValue(primaryServerProvidersAtom);
  const createGroup = useCreateGroup();
  const [selectedId, setSelectedId] = useState<FleetTemplateId | null>(null);
  const [startEmptyOpen, setStartEmptyOpen] = useState(false);
  const hintId = useId();
  const selected = FLEET_TEMPLATES.find((template) => template.id === selectedId) ?? null;

  const cards = useMemo(
    () =>
      FLEET_TEMPLATES.map((template) => ({
        template,
        plan: planFleetHire({ template, providers }),
      })),
    [providers],
  );

  return (
    <SidebarInset tone="foreground" className="h-dvh min-h-0 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <WorkspacePageHeader className="border-b border-border">
          <span className="text-sm font-medium text-muted-foreground">{t("New space")}</span>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold">{t("Start from a fleet")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("Pick the team you need. You can adjust it before it starts.")}
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(({ template, plan }) => (
                <li key={template.id}>
                  <TemplateCard
                    template={template}
                    plan={plan}
                    selected={template.id === selectedId}
                    onSelect={() =>
                      setSelectedId((current) => (current === template.id ? null : template.id))
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-6">
          <Button variant="ghost" onClick={() => setStartEmptyOpen(true)}>
            {t("Start empty")}
          </Button>
          <div className="flex min-w-0 items-center justify-end gap-3">
            {/* Why the primary action is off, said next to it rather than left to
                the grey to explain. The button stays on the row at 360: the hint
                wraps, it does not push. */}
            {selected === null ? (
              <p id={hintId} className="min-w-0 text-xs text-muted-foreground">
                {t("Pick a fleet to continue.")}
              </p>
            ) : null}
            <Button
              className="shrink-0"
              disabled={selected === null}
              aria-describedby={selected === null ? hintId : undefined}
              onClick={() => {
                if (selected === null) return;
                void navigate({
                  to: "/spaces/new/$templateId",
                  params: { templateId: selected.id },
                });
              }}
            >
              {t("Hire fleet")}
            </Button>
          </div>
        </div>
      </div>
      {startEmptyOpen ? (
        <NewGroupDialog
          open
          bots={bots}
          onOpenChange={setStartEmptyOpen}
          onCreate={(input) => {
            void createGroup(input).then((groupId) => {
              if (groupId !== null) setStartEmptyOpen(false);
            });
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

function TemplateCard({
  template,
  plan,
  selected,
  onSelect,
}: {
  readonly template: FleetTemplate;
  readonly plan: FleetHirePlan;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { t } = useI18n();
  const Icon = TEMPLATE_ICONS[template.icon];

  // The plan carries contract members, so the role catalogue draws the avatar.
  // A role the catalogue does not know cannot be drawn, so the card skips it.
  const catalogued = plan.members.flatMap((member) => {
    const role = fleetRole(member.roleId);

    return role === undefined ? [] : [{ member, avatar: role.avatar }];
  });

  const members =
    catalogued.length > CARD_MEMBER_SLOTS ? catalogued.slice(0, CARD_MEMBER_SLOTS - 1) : catalogued;

  const overflow = plan.members.length - members.length;

  // The Card border stays underneath, so the ring is what changes: 1px at rest,
  // 2px and the selected surface once picked. Focus draws its own 2px ring
  // outside the selected one, so selection and focus never read as one state.
  return (
    <Card
      render={
        <button
          type="button"
          aria-pressed={selected}
          onClick={onSelect}
          data-template-id={template.id}
        />
      }
      className="h-full cursor-pointer gap-3 p-4 text-left ring-1 ring-border/70 outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-pressed:bg-selected aria-pressed:ring-2 aria-pressed:ring-ring"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium">{t(template.name)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(template.description)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {members.map(({ member, avatar }) => (
          <span key={member.roleId} className="flex min-w-0 items-center gap-1.5">
            <BotAvatarView avatar={avatar} name={member.name} className="size-5" />
            <span className="max-w-24 truncate text-xs text-muted-foreground">
              {t(member.name)}
            </span>
            {member.isBoss ? (
              <Badge variant="secondary" size="sm">
                {t("Boss")}
              </Badge>
            ) : null}
          </span>
        ))}
        {overflow > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("{count} more", { count: overflow })}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
