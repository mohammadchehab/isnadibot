import { useAtomValue } from "@effect/atom-react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { isGroupBotMember, type BotId } from "@isnadi/contracts";
import { Predicate } from "effect";
import { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { botEnvironment, environmentBotsAtom, environmentGroupsAtom } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { ChoiceRow } from "../threads/thread-settings-content";
import type { ThreadSettingsPickerStackParams } from "../threads/thread-settings-picker-context";
import { SPACE_SETTINGS_HEADER_OPTIONS } from "./space-settings-routes";

/**
 * The space's members, one radio row each, with the current boss checked. It
 * offers only bots the space already holds, so the picker cannot create a
 * membership the server would reject.
 */
export function SpaceSettingsBossScreen() {
  const { t } = useMobileI18n();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<ThreadSettingsPickerStackParams, "SpaceSettingsBoss">>();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const { environmentId, groupId } = route.params;
  const groups = useAtomValue(environmentGroupsAtom(environmentId));
  const bots = useAtomValue(environmentBotsAtom(environmentId));
  const setBoss = useAtomCommand(botEnvironment.groups.setBoss, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  const group = groups.find((candidate) => candidate.id === groupId) ?? null;

  const memberIds = new Set(
    (group?.members ?? []).filter(isGroupBotMember).map((member) => member.botId),
  );

  const members = bots.filter((bot) => bot.archivedAt === null && memberIds.has(bot.id));

  const choose = useCallback(
    (bossBotId: BotId) => {
      if (busy) return;

      const write = async () => {
        setBusy(true);

        const result = await setBoss({
          environmentId,
          input: { groupId, bossBotId, unassignPreviousBoss: false },
        });

        setBusy(false);

        if (Predicate.isTagged(result, "Failure")) {
          Alert.alert(t("Could not change group boss"));

          return;
        }

        navigation.goBack();
      };

      void write();
    },
    [busy, environmentId, groupId, navigation, setBoss, t],
  );

  return (
    <>
      <NativeStackScreenOptions options={SPACE_SETTINGS_HEADER_OPTIONS} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={t("Boss")} onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView
        className="flex-1 bg-sheet"
        contentContainerStyle={{
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 16,
          paddingTop: 16,
        }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        {members.length === 0 ? (
          <Text className="px-1 py-6 text-center text-sm text-foreground-muted">
            {t("No bots yet")}
          </Text>
        ) : (
          <View className="overflow-hidden rounded-2xl bg-card">
            {members.map((bot, index) => (
              <ChoiceRow
                key={bot.id}
                isLast={index === members.length - 1}
                label={bot.name}
                selected={bot.id === group?.bossBotId}
                onPress={() => choose(bot.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}
