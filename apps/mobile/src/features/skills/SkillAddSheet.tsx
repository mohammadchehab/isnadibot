import type { SkillId } from "@isnadi/contracts";
import {
  skillConnectorName,
  skillSizeLabel,
  useSkillRegistryActions,
  type RegistrySkill,
  type SkillAddScope,
} from "@isnadi/client-runtime/skills";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useMobileI18n } from "../../lib/i18n";
import { useThemeColor } from "../../lib/useThemeColor";
import { SkillSheet, SkillSheetLabel, SkillSheetNote, SkillSheetPrimary } from "./SkillSheet";

const SCOPES: readonly SkillAddScope[] = ["this-space", "all-spaces"];

const SCOPE_TITLES = { "this-space": "This space", "all-spaces": "All spaces" } as const;

/** One provider skill: its connector's mark, its name and what it costs to load. */
function SkillProviderRow({
  skill,
  selected,
  onSelect,
}: {
  readonly skill: RegistrySkill;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const checkmarkColor = useThemeColor("--color-icon");
  const driver = skill.providerDriver ?? "";

  return (
    <Pressable
      accessibilityLabel={skill.name}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className="h-10 flex-row items-center gap-2.5 px-2.5"
      onPress={onSelect}
    >
      <Text className="w-2 font-mono text-2xs text-foreground-muted">
        {skillConnectorName(driver).charAt(0)}
      </Text>
      <Text className="shrink text-xs text-foreground" numberOfLines={1}>
        {skill.name}
      </Text>
      <View className="flex-1" />
      <Text className="text-3xs text-foreground-muted">{skillSizeLabel(skill.sizeTokens)}</Text>
      {selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColor={checkmarkColor}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

/** Where the added skill lands: this space's folder, or the user's, which every space sees. */
function SkillScopeRow({
  scope,
  selected,
  onSelect,
}: {
  readonly scope: SkillAddScope;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { t } = useMobileI18n();
  const checkmarkColor = useThemeColor("--color-icon");
  const title = t(SCOPE_TITLES[scope]);

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      className="h-10 flex-row items-center gap-2.5 px-2.5"
      onPress={onSelect}
    >
      <Text className="text-xs text-foreground">{title}</Text>
      <View className="flex-1" />
      {selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColor={checkmarkColor}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

/**
 * Add a skill, from the provider copy already on this computer. The frame draws one flat
 * "From a provider" group and no .zip route: an archive has to be uploaded from the desktop
 * app, and the sheet says so rather than offering a control that cannot work here.
 *
 * The first provider skill is selected so the footer is live on open, which is the state the
 * frame draws. A Community skill hands over to the approval sheet instead of closing, because
 * nothing reaches a bot before the user reads it (D28).
 */
export function SkillAddSheet({
  skills,
  projectName,
  onClose,
  onNeedsApproval,
}: {
  readonly skills: readonly RegistrySkill[];
  /** The project the subtitle names; absent when the source knows none. */
  readonly projectName: string | undefined;
  readonly onClose: () => void;
  readonly onNeedsApproval: (skillId: SkillId) => void;
}) {
  const { t } = useMobileI18n();
  const actions = useSkillRegistryActions();

  const providerSkills = skills.filter(
    (skill) => skill.source === "provider" && skill.providerDriver !== undefined,
  );

  const [selectedSkillId, setSelectedSkillId] = useState<string | undefined>(providerSkills[0]?.id);

  const [scope, setScope] = useState<SkillAddScope>("this-space");

  const submit = (): void => {
    if (actions === null || selectedSkillId === undefined) return;

    const outcome = actions.addSkill({ source: "provider", scope, input: selectedSkillId });

    if (outcome.kind === "needs-approval") onNeedsApproval(outcome.skillId);
    else if (outcome.kind === "added") onClose();
  };

  return (
    <SkillSheet
      title={t("Add a skill")}
      subtitle={
        projectName === undefined
          ? t("This computer")
          : t("{project} · this computer", { project: projectName })
      }
      onClose={onClose}
      footer={
        <SkillSheetPrimary
          label={t("Add skill")}
          disabled={actions === null || selectedSkillId === undefined}
          onPress={submit}
        />
      }
    >
      <View className="gap-1">
        <SkillSheetLabel>{t("From a provider")}</SkillSheetLabel>
        {providerSkills.map((skill) => (
          <SkillProviderRow
            key={skill.id}
            skill={skill}
            selected={skill.id === selectedSkillId}
            onSelect={() => {
              setSelectedSkillId(skill.id);
            }}
          />
        ))}
      </View>
      <View className="gap-1">
        <SkillSheetLabel>{t("Add to")}</SkillSheetLabel>
        {SCOPES.map((option) => (
          <SkillScopeRow
            key={option}
            scope={option}
            selected={option === scope}
            onSelect={() => {
              setScope(option);
            }}
          />
        ))}
      </View>
      <SkillSheetNote>{t("A .zip has to be uploaded from the desktop app.")}</SkillSheetNote>
    </SkillSheet>
  );
}
