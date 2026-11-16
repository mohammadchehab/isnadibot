import { useBotSkills } from "@isnadi/client-runtime/skills";
import { isAtomCommandInterrupted } from "@isnadi/client-runtime/state/runtime";
import type { BotSkill, SkillId } from "@isnadi/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { Predicate } from "effect";
import { useCallback } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { useMobileI18n } from "../../lib/i18n";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { botEnvironment, environmentGroupsAtom } from "../../state/bots";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadEngineBot } from "../../state/use-thread-engine-bot";
import type { ThreadSettingsPickerStackParams } from "../threads/thread-settings-picker-context";
import { botSkillRows, botSkillsOnCount, toggleBotSkill } from "./botSkillsRows";

/** A skill's switch: the registry's name and description, or the id while the registry has no row. */
function BotSkillSwitchRow(props: {
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly onValueChange: (enabled: boolean) => void;
}) {
  return (
    <View className="min-h-12 flex-row items-center gap-2.5 px-2.5 py-1.5">
      <View className="flex-1 gap-0.5">
        <Text className="text-xs font-t3-medium text-foreground">{props.name}</Text>
        {props.description ? (
          <Text className="text-3xs text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      <ThemedSwitch
        accessibilityLabel={props.name}
        onValueChange={props.onValueChange}
        value={props.enabled}
      />
    </View>
  );
}

/** The sheet's group heading: the wide tracking the frames draw, in sentence case. */
function BotSkillsGroupLabel(props: { readonly label: string }) {
  return (
    <Text className="text-3xs font-t3-bold tracking-label text-foreground-muted">
      {props.label}
    </Text>
  );
}

/**
 * One bot's skills, reached from its chat's settings: what it loads, and the switch that lets
 * it reach the rest of the space's registry. Both switches write straight to the bot — the
 * sheet has no Save, so a press is the change.
 */
export function BotSkillsScreen() {
  const route = useRoute<RouteProp<ThreadSettingsPickerStackParams, "ThreadSettingsSkills">>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useMobileI18n();
  const { environmentId, botId } = route.params;

  const groups = useAtomValue(environmentGroupsAtom(environmentId));
  const bot = useThreadEngineBot(environmentId, { botId });
  const botSkills = useBotSkills(bot ?? {});
  const rows = botSkillRows(botSkills.entries);
  const onCount = botSkillsOnCount(rows);
  const spaceName = bot?.groupId ? groups.find((group) => group.id === bot.groupId)?.name : null;
  const updateBot = useAtomCommand(botEnvironment.update, { reportFailure: false });

  const write = useCallback(
    (input: { readonly skills?: readonly BotSkill[]; readonly skillRegistryAccess?: boolean }) => {
      if (!bot) return;

      void updateBot({
        environmentId,
        input: {
          botId: bot.id,
          ...(input.skills ? { skills: [...input.skills] } : {}),
          ...(input.skillRegistryAccess === undefined
            ? {}
            : { skillRegistryAccess: input.skillRegistryAccess }),
        },
      }).then((result) => {
        if (Predicate.isTagged(result, "Failure") && !isAtomCommandInterrupted(result)) {
          Alert.alert(t("Could not change this bot's skills"));
        }
      });
    },
    [bot, environmentId, t, updateBot],
  );

  const toggleSkill = useCallback(
    (skillId: SkillId, enabled: boolean) => {
      write({ skills: toggleBotSkill(bot?.skills ?? [], skillId, enabled) });
    },
    [bot, write],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title={t("Skills")} onBack={() => navigation.goBack()} />
        </>
      ) : null}
      {bot ? (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-3 px-4 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <View className="gap-0.5">
            <Text className="text-lg font-t3-bold text-foreground">
              {t("{name}'s skills", { name: bot.name })}
            </Text>
            <Text className="text-3xs text-foreground-muted">
              {spaceName
                ? t("{space} · {count} on", { space: spaceName, count: onCount })
                : t("{count} on", { count: onCount })}
            </Text>
          </View>

          {rows.length === 0 ? (
            <Text className="text-3xs text-foreground-muted">{t("No skills yet")}</Text>
          ) : (
            <>
              <BotSkillsGroupLabel label={t("On for this bot")} />
              <View className="gap-3">
                {rows.map((row) => (
                  <BotSkillSwitchRow
                    key={row.skillId}
                    name={row.name}
                    description={row.description}
                    enabled={row.enabled}
                    onValueChange={(enabled) => toggleSkill(row.skillId, enabled)}
                  />
                ))}
              </View>
            </>
          )}

          <BotSkillsGroupLabel label={t("Anywhere")} />
          <View className="h-px bg-border-subtle" />
          <BotSkillSwitchRow
            name={t("Use other skills from the registry")}
            description={t(
              "Let {name} load this space's skills when a task matches. It sees names and one-line descriptions only.",
              { name: bot.name },
            )}
            enabled={botSkills.registryAccess}
            onValueChange={(enabled) => write({ skillRegistryAccess: enabled })}
          />

          <Text className="text-3xs leading-4 text-foreground-muted">
            {t(
              "Turning a skill off keeps it in the space. It only stops this bot from loading it.",
            )}
          </Text>

          {/* Drawn inert: the registry screen is a Settings route, and this sheet is a chat
              settings push that cannot reach it. It goes live with the settings link. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            disabled
            className="h-9 items-center justify-center rounded-lg bg-secondary"
          >
            <Text className="text-sm font-t3-medium text-secondary-foreground">
              {t("Open the registry")}
            </Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </View>
  );
}
