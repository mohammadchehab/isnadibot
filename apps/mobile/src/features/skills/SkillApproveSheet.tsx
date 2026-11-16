import {
  skillOriginSource,
  skillSizeLabel,
  useSkillRegistryActions,
  type RegistrySkill,
} from "@isnadi/client-runtime/skills";
import { ScrollView, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import {
  SkillSheet,
  SkillSheetLabel,
  SkillSheetNote,
  SkillSheetPrimary,
  SkillSheetSecondary,
} from "./SkillSheet";

/** Where a Community skill came from, and what approving its commit takes in. */
function SkillApproveSource({ skill }: { readonly skill: RegistrySkill }) {
  const { t } = useMobileI18n();
  const origin = skill.origin;

  if (origin === undefined) return null;

  return (
    <View className="gap-0.5 rounded-lg bg-subtle px-2.5 py-2">
      <Text className="font-mono text-2xs text-foreground">{skillOriginSource(origin.url)}</Text>
      <Text className="text-3xs text-foreground-muted">
        {t("Commit {commit} · {count} files · {size}", {
          commit: origin.commit,
          count: skill.fileCount,
          size: skillSizeLabel(skill.sizeTokens),
        })}
      </Text>
    </View>
  );
}

/** The SKILL.md body, in a block the user can scroll through without moving the sheet. */
function SkillApproveInstructions({ instructions }: { readonly instructions: string }) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      className="rounded-lg border border-border px-2.5 py-2"
      style={{ height: 150 }}
    >
      <Text className="font-mono text-2xs text-foreground">{instructions}</Text>
    </ScrollView>
  );
}

/** Every file the skill brings, and what each one costs to load. */
function SkillApproveFiles({ skill }: { readonly skill: RegistrySkill }) {
  const files = skill.files ?? [];

  if (files.length === 0) return null;

  return (
    <View className="gap-1">
      {files.map((file) => (
        <View key={file.path} className="flex-row items-center justify-between gap-3">
          <Text className="shrink font-mono text-2xs text-foreground" numberOfLines={1}>
            {file.path}
          </Text>
          <Text className="text-3xs text-foreground-muted">{skillSizeLabel(file.sizeTokens)}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The second step of adding a Community skill: what the bot will be told, and every file that
 * arrives with it, before anything reaches a bot. Approving pins the commit it read (D28).
 *
 * It leads with the skill's provenance instead of the provider rows, because the source is
 * settled by the time this opens. The instructions and the file list are drawn only when the
 * row carries them, so a skill with no preview still asks for a decision.
 */
export function SkillApproveSheet({
  skill,
  onClose,
}: {
  readonly skill: RegistrySkill;
  readonly onClose: () => void;
}) {
  const { t } = useMobileI18n();
  const actions = useSkillRegistryActions();
  const instructions = skill.instructions;

  return (
    <SkillSheet
      title={t("Approve this skill?")}
      subtitle={t("Community · {name}", { name: skill.name })}
      onClose={onClose}
      footer={
        <View className="flex-row gap-2">
          <SkillSheetSecondary className="flex-1" label={t("Cancel")} onPress={onClose} />
          <SkillSheetPrimary
            className="flex-1"
            label={t("Approve")}
            disabled={actions === null}
            onPress={() => {
              actions?.approveSkill(skill.id);
              onClose();
            }}
          />
        </View>
      }
    >
      <SkillApproveSource skill={skill} />
      {instructions === undefined ? null : (
        <>
          <SkillSheetLabel>{t("What the bot will be told")}</SkillSheetLabel>
          <SkillApproveInstructions instructions={instructions} />
        </>
      )}
      <SkillSheetLabel>{t("Files")}</SkillSheetLabel>
      <SkillApproveFiles skill={skill} />
      <SkillSheetNote>
        {t("Approving pins this commit. If the folder changes, Isnadi asks again.")}
      </SkillSheetNote>
    </SkillSheet>
  );
}
