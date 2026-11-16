import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Predicate } from "effect";
import { useCallback, useState } from "react";
import { Alert, Platform } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { useMobileI18n } from "../../lib/i18n";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { botEnvironment } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import type { ThreadSettingsPickerStackParams } from "../threads/thread-settings-picker-context";
import { SpaceSettingsContent } from "./space-settings-content";
import { SPACE_SETTINGS_HEADER_OPTIONS } from "./space-settings-routes";

/**
 * The space's own settings, pushed inside the chat settings sheet. It writes
 * through the same `botEnvironment` commands web uses, so the phone refuses
 * exactly what the server would refuse.
 */
export function SpaceSettingsRouteScreen() {
  const { t } = useMobileI18n();
  const route = useRoute<RouteProp<ThreadSettingsPickerStackParams, "SpaceSettings">>();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const { environmentId, groupId } = route.params;
  const setKeepBusy = useAtomCommand(botEnvironment.groups.setKeepBusy, { reportFailure: false });
  const [busy, setBusy] = useState(false);

  const openBossPicker = useCallback(
    () => navigation.navigate("SpaceSettingsBoss", { environmentId, groupId }),
    [environmentId, groupId, navigation],
  );

  const changeKeepBusy = useCallback(
    (keepBusy: boolean) => {
      const write = async () => {
        setBusy(true);
        const result = await setKeepBusy({ environmentId, input: { groupId, keepBusy } });

        setBusy(false);

        if (Predicate.isTagged(result, "Failure")) {
          Alert.alert(t("Could not change keep-busy for this group"));
        }
      };

      void write();
    },
    [environmentId, groupId, setKeepBusy, t],
  );

  return (
    <>
      <NativeStackScreenOptions options={SPACE_SETTINGS_HEADER_OPTIONS} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={t("Space settings")} onBack={() => navigation.goBack()} />
      ) : null}
      <SpaceSettingsContent
        busy={busy}
        environmentId={environmentId}
        groupId={groupId}
        onKeepBusyChange={changeKeepBusy}
        onOpenBossPicker={openBossPicker}
      />
    </>
  );
}
