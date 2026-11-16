import type { BotId } from "@isnadi/contracts";
import {
  skillAttentionActionLabel,
  skillAttentionDetail,
  skillAttentionLabel,
  skillLastLoadedLabel,
  skillSizeLabel,
  skillSourceLabel,
  skillUsedByPresentation,
  type RegistrySkill,
  type SkillAttention,
  type SkillUsedByPresentation,
} from "@isnadi/client-runtime/skills";
import { MoreHorizontalIcon, SparklesIcon, Trash2Icon } from "lucide-react";

import { useI18n } from "../../i18n";
import { cn } from "../../lib/utils";
import { BotAvatarView } from "../roster/BotAvatarView";
import type { Bot } from "../roster/types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { TableCell, TableRow } from "../ui/table";

/**
 * Overlapping avatars for two or three bots. The ids come from the registry; a bot the roster
 * no longer has is skipped rather than drawn as a blank ring.
 */
function SkillUsedByStack({
  botIds,
  bots,
}: {
  readonly botIds: readonly BotId[];
  readonly bots: readonly Bot[];
}) {
  return (
    <span className="flex items-center">
      {botIds.map((botId, index) => {
        const bot = bots.find((candidate) => candidate.id === botId);

        if (!bot) return null;

        return (
          <BotAvatarView
            key={botId}
            avatar={bot.avatar}
            name={bot.name}
            className={cn("size-5 rounded-full ring-2 ring-background", index > 0 && "-ms-1.5")}
          />
        );
      })}
    </span>
  );
}

/**
 * One bot, drawn as the avatar chip the roster uses elsewhere: a 16px face and the name.
 */
function SkillUsedByBot({
  botId,
  label,
  bots,
}: {
  readonly botId: BotId;
  readonly label: string;
  readonly bots: readonly Bot[];
}) {
  const bot = bots.find((candidate) => candidate.id === botId);

  if (!bot) return <span className="truncate">{label}</span>;

  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-secondary/60 py-0.5 pe-2 ps-0.5">
      <BotAvatarView avatar={bot.avatar} name={bot.name} className="size-4 rounded-full" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** The Used by cell: a chip for one bot, a stack for up to three, words otherwise. */
function SkillUsedByCell({
  usedBy,
  bots,
}: {
  readonly usedBy: SkillUsedByPresentation;
  readonly bots: readonly Bot[];
}) {
  switch (usedBy.kind) {
    case "bot":
      return <SkillUsedByBot botId={usedBy.botId} label={usedBy.label} bots={bots} />;
    case "stack":
      return <SkillUsedByStack botIds={usedBy.botIds} bots={bots} />;
    case "none":
    case "text":
      return <span className="truncate">{usedBy.label}</span>;
  }
}

/**
 * One registry row. A row that needs the user swaps its Source badge for the state word, grows a
 * warning line under the description and moves its action into the Last loaded cell, so the name
 * and the source never move sideways between states.
 */
export function SkillRegistryRow({
  skill,
  attention,
  bots,
  nowMs,
  removeLabel,
  onApprove,
}: {
  readonly skill: RegistrySkill;
  readonly attention: SkillAttention | null;
  readonly bots: readonly Bot[];
  readonly nowMs: number;
  /** The row menu's destructive item, worded for the scope the skill was added to. */
  readonly removeLabel: string;
  /** Opens the approval dialog; a row waiting on a connector has nothing to approve. */
  readonly onApprove: () => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const botNamesById = new Map(bots.map((bot) => [bot.id, bot.name]));
  const usedBy = skillUsedByPresentation(skill, botNamesById, i18n);

  return (
    <TableRow data-skill-row={skill.id} presentation="divided" className="group">
      <TableCell className="px-3 py-2.5 align-top whitespace-normal">
        <div className="flex min-w-0 items-start gap-2">
          <SparklesIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <span className="block truncate font-mono text-xs text-foreground">{skill.name}</span>
            <p className="text-xs text-muted-foreground">{skill.description}</p>
            {attention ? (
              <p className="text-11px text-warning-foreground">
                {skillAttentionDetail(skill, attention, i18n)}
              </p>
            ) : null}
          </div>
        </div>
      </TableCell>
      <TableCell presentation="muted" className="w-30 px-3 py-2.5 align-top text-xs">
        <SkillUsedByCell usedBy={usedBy} bots={bots} />
      </TableCell>
      <TableCell className="w-24 px-3 py-2.5 align-top">
        {attention ? (
          <Badge size="sm" variant="warning">
            {skillAttentionLabel(attention, i18n)}
          </Badge>
        ) : (
          <Badge size="sm" variant={skill.source === "community" ? "warning" : "secondary"}>
            {skillSourceLabel(skill.source, i18n)}
          </Badge>
        )}
      </TableCell>
      <TableCell presentation="muted" className="w-18 px-3 py-2.5 align-top">
        <span className="font-mono text-11px tabular-nums">{skillSizeLabel(skill.sizeTokens)}</span>
      </TableCell>
      <TableCell presentation="muted" className="w-24 px-3 py-2.5 align-top text-xs">
        {attention ? (
          <Button
            size="xs"
            variant={attention.kind === "needs-approval" ? "default" : "outline"}
            onClick={attention.kind === "needs-connector" ? undefined : onApprove}
          >
            {skillAttentionActionLabel(attention, i18n)}
          </Button>
        ) : (
          skillLastLoadedLabel(skill, nowMs, i18n)
        )}
      </TableCell>
      <TableCell className="w-10 px-1 py-2.5 align-top">
        <Menu>
          <MenuTrigger
            render={
              <Button
                type="button"
                size="icon-sm"
                variant="ghost-muted"
                presentation="reveal-on-hover"
                aria-label={t("Actions for {skill}", { skill: skill.name })}
              >
                <MoreHorizontalIcon aria-hidden />
              </Button>
            }
          />
          <MenuPopup align="end" className="min-w-58">
            <MenuItem variant="destructive">
              <Trash2Icon aria-hidden />
              {removeLabel}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </TableCell>
    </TableRow>
  );
}
