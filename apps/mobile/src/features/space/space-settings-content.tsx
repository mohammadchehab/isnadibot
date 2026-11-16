import { useAtomValue } from "@effect/atom-react";
import { spaceSettingsState } from "@isnadi/client-runtime/space/settings";
import { isGroupBotMember, type EnvironmentId, type GroupId } from "@isnadi/contracts";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import { environmentBotsAtom, environmentGroupsAtom } from "../../state/bots";
import { environmentSnapshotAtom } from "../../state/shell";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

/**
 * The two settings a space has: its boss, and whether idle bots take the next
 * card. Everything the rows show comes from the shared rules in
 * `@isnadi/client-runtime/space/settings`, so the phone refuses what the server
 * would refuse, in the same words web uses.
 */
export function SpaceSettingsContent(props: {
  readonly environmentId: EnvironmentId;
  readonly groupId: GroupId;
  readonly busy: boolean;
  readonly onOpenBossPicker: () => void;
  readonly onKeepBusyChange: (keepBusy: boolean) => void;
}) {
  const { t, plural } = useMobileI18n();
  const insets = useSafeAreaInsets();
  const snapshot = useAtomValue(environmentSnapshotAtom(props.environmentId));
  const groups = useAtomValue(environmentGroupsAtom(props.environmentId));
  const bots = useAtomValue(environmentBotsAtom(props.environmentId));

  const group = groups.find((candidate) => candidate.id === props.groupId) ?? null;

  if (snapshot === null) {
    return <SpaceSettingsSkeleton bottomInset={insets.bottom} />;
  }

  if (!group) {
    return (
      <View className="flex-1 items-center justify-center bg-sheet px-6">
        <Text className="text-center text-base text-foreground-muted">
          {t("This space is no longer available.")}
        </Text>
      </View>
    );
  }

  const memberIds = new Set(group.members.filter(isGroupBotMember).map((member) => member.botId));

  const members = bots
    .filter((bot) => bot.archivedAt === null && memberIds.has(bot.id))
    .map((bot) => ({ id: bot.id, name: bot.name }));

  const state = spaceSettingsState({ members, bossBotId: group.bossBotId }, { t, plural });
  const keepsBusy = group.keepBusy ?? false;

  const keepBusySubtitle = state.keepBusyDisabled
    ? state.keepBusyHint
    : keepsBusy
      ? t("Turn it off and bots stop taking new cards; cards already running finish.")
      : t("When a bot goes idle, it gets the next card. The boss is woken only to judge.");

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{
        gap: 24,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 20,
        paddingTop: 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View className="gap-1 px-2">
        <Text className="text-xl font-t3-bold text-foreground" numberOfLines={1}>
          {group.name}
        </Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {state.statusLine}
        </Text>
      </View>
      <SettingsSection title={t("Work")}>
        <SettingsRow
          disabled={state.bossDisabled || props.busy}
          icon="person.crop.circle"
          label={t("Boss")}
          subtitle={state.bossHint ?? undefined}
          value={state.bossName ?? state.bossPlaceholder}
          onPress={props.onOpenBossPicker}
        />
        <SettingsSwitchRow
          disabled={state.keepBusyDisabled || props.busy}
          icon="bolt.circle"
          label={t("Keep everyone busy")}
          subtitle={keepBusySubtitle ?? undefined}
          value={keepsBusy}
          onValueChange={props.onKeepBusyChange}
        />
      </SettingsSection>
    </ScrollView>
  );
}

/**
 * The space's rows before the shell arrives: a still placeholder at the rows'
 * own heights. It never animates — a repainting shimmer is a frame the app
 * cannot spare on a phone.
 */
function SpaceSettingsSkeleton(props: { readonly bottomInset: number }) {
  return (
    <View
      className="flex-1 gap-6 bg-sheet px-5 pt-4"
      style={{ paddingBottom: props.bottomInset + 24 }}
    >
      <View className="gap-2 px-2">
        <View className="h-6 w-40 rounded-lg bg-subtle" />
        <View className="h-4 w-28 rounded-md bg-subtle" />
      </View>
      <View className="gap-2">
        <View className="h-4 w-16 rounded-md bg-subtle" />
        <View className="overflow-hidden rounded-3xl border-continuous bg-card">
          <View className="h-17" />
          <View className="h-17" />
        </View>
      </View>
    </View>
  );
}
