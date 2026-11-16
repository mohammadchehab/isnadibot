import type { SkillId } from "@isnadi/contracts";
import { useSkillRegistry, useSkillRegistryActions } from "@isnadi/client-runtime/skills";
import { useNavigation } from "@react-navigation/native";
import { useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { cn } from "../../lib/cn";
import { useMobileI18n } from "../../lib/i18n";
import { SkillAddSheet } from "./SkillAddSheet";
import { SkillApproveSheet } from "./SkillApproveSheet";
import { SkillRegistryList } from "./SkillRegistryList";

/**
 * Settings › Skills: what bots in this space can load on demand, grouped by where each skill
 * comes from. A platform with no registry source reads `unavailable` and renders nothing; the
 * Settings row that opens this screen is hidden for the same reason.
 *
 * "Add a skill" opens the add sheet, which asks the registry's seam to add the skill. A source
 * that cannot be written to leaves the button inert rather than hiding it, and a Community skill
 * hands over to the approval sheet before any bot can load it.
 */
export function SettingsSkillsRouteScreen() {
  const { t } = useMobileI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const registry = useSkillRegistry();
  const actions = useSkillRegistryActions();
  const [adding, setAdding] = useState(false);
  const [approving, setApproving] = useState<SkillId | null>(null);

  if (registry.state === "unavailable") return null;

  // The approval sheet reads the row it names; a row that vanished with the sheet open is dropped
  // rather than drawn from a stale copy.
  const approvingSkill =
    approving === null ? undefined : registry.skills.find((skill) => skill.id === approving);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title={t("Settings")} onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-4 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <Text className="text-lg font-t3-bold text-foreground">{t("Skills")}</Text>
        <Text className="text-3xs text-foreground-muted">
          {t("What bots in this space can do. Turn one on for a bot in its chat.")}
        </Text>
        {registry.state === "loading" ? null : registry.state === "error" ? (
          <EmptyState
            title={t("The skill registry did not load.")}
            detail={t("Try again in a moment.")}
          />
        ) : registry.skills.length === 0 ? (
          <EmptyState
            title={t("No skills yet")}
            detail={t("Skills a bot can load on demand show up here.")}
          />
        ) : (
          <SkillRegistryList
            skills={registry.skills}
            unavailableConnectors={registry.unavailableConnectors}
          />
        )}
      </ScrollView>
      <View className="px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 18) }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: actions === null }}
          disabled={actions === null}
          className={cn(
            "h-9 items-center justify-center rounded-lg bg-foreground",
            actions === null && "opacity-50",
          )}
          onPress={() => {
            setAdding(true);
          }}
        >
          <Text className="text-sm font-t3-medium text-background">{t("Add a skill")}</Text>
        </Pressable>
      </View>
      {adding ? (
        <SkillAddSheet
          skills={registry.skills}
          projectName={registry.projectName}
          onClose={() => {
            setAdding(false);
          }}
          onNeedsApproval={(skillId) => {
            setAdding(false);
            setApproving(skillId);
          }}
        />
      ) : null}
      {approvingSkill === undefined ? null : (
        <SkillApproveSheet
          skill={approvingSkill}
          onClose={() => {
            setApproving(null);
          }}
        />
      )}
    </View>
  );
}
