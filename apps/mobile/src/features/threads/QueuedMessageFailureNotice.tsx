import { commandRefusalDescription } from "@isnadi/client-runtime/state/runtime";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import type { QueuedThreadFailure } from "../../state/thread-outbox-model";

/**
 * Why a queued message did not send, with the ways out. The sentence is the
 * shared catalogue copy for the refusal, never the server's own prose, which
 * names internal ids. Try again is offered only when a person could have
 * changed the condition: a refusal that needs someone to fix the roster can be
 * cleared and sent again, while a failure the client cannot explain has nothing
 * for the user to fix.
 */
export function QueuedMessageFailureNotice(props: {
  readonly failure: QueuedThreadFailure;
  readonly onRetry: () => void;
  readonly onDiscard: () => void;
  readonly className?: string;
}) {
  const { t } = useMobileI18n();

  const canRetry = props.failure.action === "block";

  const sentence = commandRefusalDescription(props.failure.refusal, "", {
    t,
    fallback: canRetry
      ? "This chat could not send your message. Try again, or discard it."
      : "This chat could not send your message.",
  });

  return (
    <View className={props.className}>
      <Text className="text-xs leading-5 text-foreground-muted">{sentence}</Text>
      <View className="flex-row gap-4 pt-1">
        {canRetry ? (
          <Pressable accessibilityRole="button" onPress={props.onRetry}>
            <Text className="text-xs font-t3-medium text-foreground">{t("Try again")}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={props.onDiscard}>
          <Text className="text-xs font-t3-medium text-foreground-muted">{t("Discard")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
