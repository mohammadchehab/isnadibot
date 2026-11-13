import {
  FLEET_TEMPLATES,
  fleetTemplateRoles,
  type FleetTemplate,
  type FleetTemplateId,
} from "@isnadi/contracts";
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
import { useState } from "react";

import { useI18n } from "../../i18n";
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
 */
export function StartSpaceScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bots = useRosterStore((state) => state.bots);
  const createGroup = useCreateGroup();
  const [selectedId, setSelectedId] = useState<FleetTemplateId | null>(null);
  const [startEmptyOpen, setStartEmptyOpen] = useState(false);
  const selected = FLEET_TEMPLATES.find((template) => template.id === selectedId) ?? null;

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
              {FLEET_TEMPLATES.map((template) => (
                <li key={template.id}>
                  <TemplateCard
                    template={template}
                    selected={template.id === selectedId}
                    onSelect={() => setSelectedId(template.id)}
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
          <Button
            disabled={selected === null}
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
  selected,
  onSelect,
}: {
  readonly template: FleetTemplate;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { t } = useI18n();
  const Icon = TEMPLATE_ICONS[template.icon];
  const roles = fleetTemplateRoles(template);
  const members = roles.length > CARD_MEMBER_SLOTS ? roles.slice(0, CARD_MEMBER_SLOTS - 1) : roles;
  const overflow = roles.length - members.length;

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
      className="h-full cursor-pointer gap-3 p-4 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-muted/40"
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
        {members.map((role) => {
          const isBoss = role.id === template.bossRoleId;

          return (
            <span key={role.id} className="flex min-w-0 items-center gap-1.5">
              <BotAvatarView avatar={role.avatar} name={role.name} className="size-5" />
              <span className="max-w-24 truncate text-xs text-muted-foreground">
                {t(role.name)}
              </span>
              {isBoss ? (
                <Badge variant="secondary" size="sm">
                  {t("Boss")}
                </Badge>
              ) : null}
            </span>
          );
        })}
        {overflow > 0 ? (
          <span className="text-xs text-muted-foreground">
            {t("{count} more", { count: overflow })}
          </span>
        ) : null}
      </div>
    </Card>
  );
}
