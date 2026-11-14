import { ProviderInstanceId, type ProviderOptionSelection } from "@isnadi/contracts";
import type { HireMember, HireMemberNotice } from "@isnadi/client-runtime/fleet/hire";
import { SparklesIcon } from "lucide-react";

import { useI18n } from "../../i18n";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { BotModelPicker } from "../roster/BotModelPicker";
import { BotAvatarView } from "../roster/BotAvatarView";
import { TraitsPicker } from "../chat/TraitsPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { Badge } from "../ui/badge";

/** Why a member does not start on what its role asked for, said where it shows. */
function noticeCopy(notice: HireMemberNotice): string {
  switch (notice) {
    case "no-provider":
      return "No provider can run this bot yet.";
    case "provider-fallback":
      return "Runs on another provider because the role's own is not set up.";
    case "reasoning-adjusted":
      return "The model has no such reasoning level, so it starts on the model's default.";
    case "model-unavailable":
      return "The provider or model this bot picked is no longer connected.";
  }
}

/**
 * The one column track the header and every row share, so a label sits over its
 * own control by construction: Bot takes what is left, then Model, Reasoning and
 * Skills at the widths frame 2088:370 draws (x 16, 642, 834, 966 — 96 for
 * Skills). Both sides of the list build from these two exports and nothing else,
 * so the columns cannot drift apart.
 */
export const SQUAD_COLUMNS = "flex min-w-0 items-center gap-3";

export const SQUAD_CELL = {
  bot: "min-w-0 flex-1",
  model: "w-48 shrink-0",
  reasoning: "w-32 shrink-0",
  skills: "w-24 shrink-0",
} as const;

/**
 * One planned member on squad setup: what it is, the model and reasoning level
 * it starts on, and how many skills it brings. Edits go back through the draft,
 * so the row itself holds no state.
 */
export function HireMemberRow({
  member,
  instanceEntries,
  modelOptionsByInstance,
  onModelChange,
  onReasoningChange,
  disabled = false,
}: {
  readonly member: HireMember;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly onModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  readonly onReasoningChange: (options: ReadonlyArray<ProviderOptionSelection>) => void;
  /** True while the screen is sending or waiting on a send, so the row's pickers cannot change the draft. */
  readonly disabled?: boolean;
}) {
  const { t } = useI18n();
  const engine = member.engine;

  const activeEntry =
    engine === null
      ? undefined
      : instanceEntries.find((entry) => entry.instanceId === engine.provider);

  return (
    <li className="px-4 py-3" data-role-id={member.roleId}>
      <div className={SQUAD_COLUMNS}>
        <div className={`${SQUAD_CELL.bot} flex items-center gap-3`}>
          <BotAvatarView avatar={member.avatar} name={member.name} className="size-8" />
          <div className="min-w-0">
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
        </div>
        <div className={SQUAD_CELL.model}>
          {engine === null ? (
            <span className="text-sm text-muted-foreground">{t("No model yet")}</span>
          ) : (
            <BotModelPicker
              activeInstanceId={ProviderInstanceId.make(engine.provider)}
              model={engine.model}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              disabled={disabled}
              onChange={onModelChange}
            />
          )}
        </div>
        <div className={SQUAD_CELL.reasoning}>
          {engine !== null && activeEntry ? (
            <TraitsPicker
              provider={activeEntry.driverKind}
              instanceId={activeEntry.instanceId}
              models={activeEntry.models}
              model={engine.model}
              prompt=""
              onPromptChange={() => {}}
              modelOptions={engine.options}
              allowPromptInjectedEffort={false}
              triggerFit="settings-row"
              disabled={disabled}
              onModelOptionsChange={(options) => onReasoningChange(options ?? [])}
            />
          ) : null}
        </div>
        <span
          className={`${SQUAD_CELL.skills} flex items-center gap-1.5 text-xs`}
          data-testid="hire-member-skill-count"
        >
          {member.skills.length === 0 ? (
            "—"
          ) : (
            <>
              <SparklesIcon aria-hidden className="size-4 shrink-0" />
              {t("{count} on demand", { count: member.skills.length })}
            </>
          )}
        </span>
      </div>
      {member.notice === null ? null : (
        <p className="mt-1 pl-11 text-xs text-muted-foreground">{t(noticeCopy(member.notice))}</p>
      )}
    </li>
  );
}
