import {
  skillAttention,
  skillAttentionLabel,
  skillSizeLabel,
  type RegistrySkill,
} from "@isnadi/client-runtime/skills";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import { skillGroups, type SkillGroup, type SkillGroupKey } from "./skillGroups";

/** The word each group's header carries, before the approval suffix. */
const GROUP_LABELS = {
  community: "Community",
  space: "This space",
  "built-in": "Built in",
  provider: "Provider",
} as const satisfies Record<SkillGroupKey, string>;

/**
 * A badge on a row: the attention word in the warning colours when the row needs the user,
 * otherwise "Yours" in the secondary ones.
 */
function SkillBadge({
  label,
  tone,
}: {
  readonly label: string;
  readonly tone: "warning" | "secondary";
}) {
  return (
    <View
      className={
        tone === "warning"
          ? "h-4 justify-center rounded bg-warning px-1"
          : "h-4 justify-center rounded bg-secondary px-1"
      }
    >
      <Text
        className={
          tone === "warning"
            ? "text-3xs font-t3-medium text-warning-foreground"
            : "text-3xs font-t3-medium text-secondary-foreground"
        }
      >
        {label}
      </Text>
    </View>
  );
}

function SkillRow({
  skill,
  unavailableConnectors,
}: {
  readonly skill: RegistrySkill;
  readonly unavailableConnectors: readonly string[];
}) {
  const { t } = useMobileI18n();
  const attention = skillAttention(skill, unavailableConnectors);

  return (
    <View className="h-10 flex-row items-center gap-2 px-2.5">
      <Text className="shrink text-xs font-t3-medium text-foreground" numberOfLines={1}>
        {skill.name}
      </Text>
      <View className="flex-1" />
      {attention === null ? (
        skill.source === "yours" ? (
          <SkillBadge label={t("Yours")} tone="secondary" />
        ) : null
      ) : (
        <SkillBadge label={skillAttentionLabel(attention, { t })} tone="warning" />
      )}
      <Text className="text-3xs text-foreground-muted">{skillSizeLabel(skill.sizeTokens)}</Text>
    </View>
  );
}

function SkillGroupBlock({
  group,
  unavailableConnectors,
}: {
  readonly group: SkillGroup;
  readonly unavailableConnectors: readonly string[];
}) {
  const { t } = useMobileI18n();
  const label = t(GROUP_LABELS[group.key]);

  return (
    <View className="gap-0.5">
      <Text className="text-3xs font-t3-bold uppercase tracking-label text-foreground-muted">
        {group.needsApproval ? `${label} · ${t("needs your approval")}` : label}
      </Text>
      {group.skills.map((skill) => (
        <SkillRow key={skill.id} skill={skill} unavailableConnectors={unavailableConnectors} />
      ))}
    </View>
  );
}

/**
 * The registry's rows, grouped and headed. Every value comes from the seam, so phase 1 swaps
 * the source and this screen does not change.
 */
export function SkillRegistryList({
  skills,
  unavailableConnectors,
}: {
  readonly skills: readonly RegistrySkill[];
  readonly unavailableConnectors: readonly string[];
}) {
  return (
    <View className="gap-3">
      {skillGroups(skills).map((group) => (
        <SkillGroupBlock
          key={group.key}
          group={group}
          unavailableConnectors={unavailableConnectors}
        />
      ))}
    </View>
  );
}
