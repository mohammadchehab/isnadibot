import { useSkillRegistry } from "@isnadi/client-runtime/skills";
import { useNavigation } from "@react-navigation/native";
import { Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useMobileI18n } from "../../lib/i18n";
import { SkillRegistryList } from "./SkillRegistryList";

/**
 * Settings › Skills: what bots in this space can load on demand, grouped by where each skill
 * comes from. A platform with no registry source reads `unavailable` and renders nothing; the
 * Settings row that opens this screen is hidden for the same reason.
 *
 * "Add a skill" is drawn inert until the add flow lands, so the screen keeps the frame's shape
 * without promising a control that does nothing yet.
 */
export function SettingsSkillsRouteScreen() {
  const { t } = useMobileI18n();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const registry = useSkillRegistry();

  if (registry.state === "unavailable") return null;

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
          accessibilityState={{ disabled: true }}
          disabled
          className="h-9 items-center justify-center rounded-lg bg-foreground"
        >
          <Text className="text-sm font-t3-medium text-background">{t("Add a skill")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
