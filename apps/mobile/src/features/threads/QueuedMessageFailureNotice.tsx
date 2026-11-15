import { commandRefusalDescription } from "@isnadi/client-runtime/state/runtime";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useMobileI18n } from "../../lib/i18n";
import type { QueuedThreadFailure } from "../../state/thread-outbox-model";

/**
 * Why a queued message did not send, with the ways out. The sentence is the
 * shared catalogue copy for the refusal, never the server's own prose, which
 * names internal ids. Try again is offered only when a person could have
 * changed the condition: a refusal that needs someone to fix the roster can be
 * cleared and sent again, while a failure the client cannot explain has nothing
 * for the user to fix.
 *
 * The first line quotes the text that failed, because the sentence alone is the
 * same for every refusal of its kind and two failed messages would otherwise
 * stack as two identical notices.
 */
export function QueuedMessageFailureNotice(props: {
  readonly failure: QueuedThreadFailure;
  /** The text that failed, quoted once above the sentence. */
  readonly messageText: string;
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

  // One line, so a message that starts with a blank line still names itself.
  const quotedText = props.messageText.replace(/\s+/g, " ").trim();

  return (
    <View
      className={cn(
        "gap-1 rounded-2xl border border-danger-border bg-danger pt-3 px-3.5 pb-1",
        props.className,
      )}
    >
      {quotedText.length > 0 ? (
        <Text className="text-xs leading-5 text-foreground-muted" numberOfLines={1}>
          {quotedText}
        </Text>
      ) : null}
      <Text className="text-xs leading-5 text-foreground-muted">{sentence}</Text>
      <View className="flex-row gap-4">
        {canRetry ? (
          <Pressable
            accessibilityRole="button"
            className="min-h-11 justify-center"
            onPress={props.onRetry}
          >
            <Text className="text-xs font-t3-medium text-danger-foreground">{t("Try again")}</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          className="min-h-11 justify-center"
          onPress={props.onDiscard}
        >
          <Text className="text-xs font-t3-medium text-foreground-muted">{t("Discard")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
