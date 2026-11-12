import { useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import type { BotId, EnvironmentId, ThreadId } from "@isnadi/contracts";
import { useEffect, useRef } from "react";
import { View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { ControlPill } from "../../components/ControlPill";
import { useMobileI18n } from "../../lib/i18n";
import { useThemeColor } from "../../lib/useThemeColor";
import { environmentBotsAtom } from "../../state/bots";
import { computerEnvironment } from "../../state/computer";
import { useEnvironmentQuery } from "../../state/query";

/**
 * Shows that a bot's computer is running, with the way into the phone's live view. The bar takes
 * the place of the composer's usual notice only while there is a computer to watch.
 */
export function ComputerDesktopNotice(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly botId: BotId | null;
  /** Changes when the chat's latest turn starts or settles, which is when a computer starts or stops. */
  readonly turnActivity: string;
}) {
  const { t } = useMobileI18n();
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon-subtle");
  const bots = useAtomValue(environmentBotsAtom(props.environmentId));
  const bot = props.botId === null ? null : bots.find((entry) => entry.id === props.botId);

  const query = useEnvironmentQuery(
    bot
      ? computerEnvironment.state({
          environmentId: props.environmentId,
          input: { threadId: props.threadId },
        })
      : null,
  );

  const state = query.data;
  const { refresh } = query;
  const seenActivity = useRef(props.turnActivity);
  useEffect(() => {
    if (seenActivity.current === props.turnActivity) return;
    seenActivity.current = props.turnActivity;
    refresh();
  }, [props.turnActivity, refresh]);

  if (!bot || (state?.status !== "ready" && state?.status !== "human")) return null;

  return (
    <View className="mx-4 mb-2 flex-row items-center gap-2 rounded-xl border border-border-subtle bg-card px-3 py-2">
      <SymbolView name="desktopcomputer" size={14} tintColor={iconColor} type="monochrome" />
      <Text className="flex-1 text-sm font-t3-medium text-foreground" numberOfLines={2}>
        {t("{name}'s computer is running", { name: bot.name })}
      </Text>
      <ControlPill
        variant="primary"
        label={t("Watch")}
        icon="play.rectangle"
        onPress={() => {
          navigation.navigate("ComputerViewer", {
            threadId: props.threadId,
            botName: bot.name,
          });
        }}
      />
    </View>
  );
}
