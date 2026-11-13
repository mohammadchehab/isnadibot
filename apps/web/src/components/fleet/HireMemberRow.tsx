import { ProviderInstanceId, type ProviderOptionSelection } from "@isnadi/contracts";
import type { HireMember } from "@isnadi/client-runtime/fleet/hire";
import type { SquadSeedNotice } from "@isnadi/client-runtime/fleet/squad-seed";

import { useI18n } from "../../i18n";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { BotModelPicker } from "../roster/BotModelPicker";
import { BotAvatarView } from "../roster/BotAvatarView";
import { TraitsPicker } from "../chat/TraitsPicker";
import type { ModelEsque } from "../chat/providerIconUtils";
import { Badge } from "../ui/badge";

/** Why a member does not start on what its role asked for, said where it shows. */
function noticeCopy(notice: SquadSeedNotice): string {
  switch (notice) {
    case "no-provider":
      return "No provider can run this bot yet.";
    case "provider-fallback":
      return "Runs on another provider because the role's own is not set up.";
    case "reasoning-adjusted":
      return "The model has no such reasoning level, so it starts on the model's default.";
  }
}

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
}: {
  readonly member: HireMember;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly onModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  readonly onReasoningChange: (options: ReadonlyArray<ProviderOptionSelection>) => void;
}) {
  const { t } = useI18n();
  const engine = member.engine;

  const activeEntry =
    engine === null
      ? undefined
      : instanceEntries.find((entry) => entry.instanceId === engine.provider);

  return (
    <li className="px-4 py-3" data-role-id={member.roleId}>
      <div className="flex min-w-0 items-center gap-3">
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
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t("Skills")}</span>
          <span className="text-sm" data-testid="hire-member-skill-count">
            {member.skills.length === 0 ? "—" : member.skills.length}
          </span>
        </span>
        {engine === null ? (
          <span className="text-sm text-muted-foreground">{t("No model yet")}</span>
        ) : (
          <span className="flex items-center gap-2">
            <BotModelPicker
              activeInstanceId={ProviderInstanceId.make(engine.provider)}
              model={engine.model}
              instanceEntries={instanceEntries}
              modelOptionsByInstance={modelOptionsByInstance}
              onChange={onModelChange}
            />
            {activeEntry ? (
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
                onModelOptionsChange={(options) => onReasoningChange(options ?? [])}
              />
            ) : null}
          </span>
        )}
      </div>
      {member.notice === null ? null : (
        <p className="mt-1 pl-11 text-xs text-muted-foreground">{t(noticeCopy(member.notice))}</p>
      )}
    </li>
  );
}
