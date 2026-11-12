import { Match } from "effect";
import type { ComputerFrame } from "@isnadi/contracts";
import type {
  ComputerViewerNotice,
  ComputerViewerView,
} from "@isnadi/client-runtime/state/computer-viewer";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { ControlPill } from "../../components/ControlPill";
import { useMobileI18n } from "../../lib/i18n";
import { useThemeColor } from "../../lib/useThemeColor";
import { ComputerFrameView } from "./ComputerFrameView";

export interface ComputerViewerScreenProps {
  readonly botName: string;
  readonly view: ComputerViewerView;
  readonly frame: ComputerFrame | null;
  readonly frameKey: number;
  readonly notice: ComputerViewerNotice | null;
  /** False while the privacy cover hides the stage (the app switcher is open). */
  readonly showFrame: boolean;
  readonly onTakeControl: () => void;
  readonly onReturnControl: () => void;
  readonly onResume: () => void;
  readonly onClose: () => void;
}

/**
 * One bot computer on a phone: the stage, who is in control, and the one action that fits the
 * phase. Every state comes from `deriveComputerViewer`; this screen decides only what to draw.
 */
export function ComputerViewerScreen(props: ComputerViewerScreenProps) {
  const { t } = useMobileI18n();
  const insets = useSafeAreaInsets();
  const subtle = useThemeColor("--color-foreground-muted");

  const { view } = props;

  const ownerLabel = Match.value(view.owner).pipe(
    Match.when("you", () => t("You are in control")),
    Match.when("bot", () => t("{name} is in control", { name: props.botName })),
    Match.when("someone-else", () => t("Someone else is in control")),
    Match.orElse(() => t("No one is in control")),
  );

  const stageText = Match.value(view.phase).pipe(
    Match.when("connecting", () => t("Connecting to the computer…")),
    Match.when("reconnecting", () => t("Reconnecting to the computer…")),
    Match.when("unsupported", () => t("This computer is unavailable right now.")),
    Match.when("stopped", () => t("The computer is stopped.")),
    Match.when("hidden", () => t("Live view paused")),
    Match.orElse(() => (props.frame === null ? t("Waiting for the first picture…") : null)),
  );

  const noticeText = noticeTextFor(props.notice, props.botName, t);

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-3 px-4 py-2">
        <ControlPill
          icon="xmark"
          accessibilityLabel={t("Dismiss")}
          onPress={props.onClose}
          variant="circle"
        />
        <View className="flex-1">
          <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
            {t("{name}'s screen", { name: props.botName })}
          </Text>
          {view.phase === "live" ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {ownerLabel}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mx-3 flex-1 overflow-hidden rounded-2xl bg-black">
        {props.showFrame && props.frame !== null ? (
          <ComputerFrameView frame={props.frame} frameKey={props.frameKey} />
        ) : null}
        {props.showFrame && stageText !== null ? (
          <View className="absolute inset-0 items-center justify-center px-6">
            <Text className="text-center text-sm text-foreground-muted">{stageText}</Text>
          </View>
        ) : null}
        {!props.showFrame ? <PrivacyCover /> : null}
      </View>

      {noticeText === null ? null : (
        <Text className="mx-4 mt-3 text-center text-xs text-foreground-muted">{noticeText}</Text>
      )}

      <View
        className="flex-row items-center justify-center gap-2 px-4 py-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        {view.canTakeControl ? (
          <ControlPill
            variant="primary"
            label={t("Take control")}
            icon="hand.raised"
            onPress={props.onTakeControl}
          />
        ) : null}
        {view.canReturnControl ? (
          <ControlPill
            variant="primary"
            label={t("Return to {name}", { name: props.botName })}
            icon="arrow.uturn.backward"
            onPress={props.onReturnControl}
          />
        ) : null}
        {view.canResume ? (
          <ControlPill
            variant="primary"
            label={t("Resume")}
            icon="play.fill"
            onPress={props.onResume}
          />
        ) : null}
        {view.phase === "hidden" ? (
          <ControlPill
            variant="primary"
            label={t("Resume watching")}
            icon="play.fill"
            onPress={props.onResume}
          />
        ) : null}
      </View>

      {view.phase === "live" && view.controlUnavailableReason !== null ? (
        <Text className="mx-6 mb-3 text-center text-xs" style={{ color: subtle }}>
          {t("Control is unavailable: {reason}", { reason: view.controlUnavailableReason })}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The frame from before the cover is dropped, so the app switcher shows this plate and never a
 * stale picture.
 */
function PrivacyCover() {
  const { t } = useMobileI18n();
  const tint = useThemeColor("--color-icon-subtle");

  return (
    <View className="absolute inset-0 items-center justify-center bg-background">
      <SymbolView name="lock.shield" size={28} tintColor={tint} type="monochrome" />
      <Text className="mt-2 text-xs text-foreground-muted">{t("Live view paused")}</Text>
    </View>
  );
}

function noticeTextFor(
  notice: ComputerViewerNotice | null,
  botName: string,
  t: ReturnType<typeof useMobileI18n>["t"],
): string | null {
  return Match.value(notice).pipe(
    Match.when("expired", () =>
      t("Your minute of control ran out, so the computer stopped. Resume it to continue."),
    ),
    Match.when("busy", () => t("Someone else took control first.")),
    Match.when("revoked", () => t("Your control ended.")),
    Match.when("stopped", () => t("The computer stopped.")),
    Match.when("ended", () =>
      t("The computer is no longer available. The bot's work may have ended."),
    ),
    Match.when("disconnected", () =>
      t("The connection dropped, so your control ended and the computer stopped."),
    ),
    Match.when("failed", () => t("The computer did not accept that. Try again.")),
    Match.when(null, () => null),
    Match.orElse(() => t("{name} is in control", { name: botName })),
  );
}
