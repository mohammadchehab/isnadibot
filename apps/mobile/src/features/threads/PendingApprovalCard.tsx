import { Match } from "effect";
import { routineApprovalSummary } from "@isnadi/client-runtime/routines";
import {
  ISNADI_CREATE_ROUTINE_TOOL_NAME,
  ISNADI_PRODUCT_FEEDBACK_TOOL_NAME,
  type ApprovalRequestId,
  type ProviderApprovalOption,
} from "@isnadi/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useMobileI18n } from "../../lib/i18n";
import type { PendingApproval } from "../../lib/threadActivity";

export interface PendingApprovalCardProps {
  readonly approval: PendingApproval;
  readonly respondingApprovalId: ApprovalRequestId | null;
  readonly onRespond: ReturnType<
    typeof import("../../state/use-selected-thread-requests").useSelectedThreadRequests
  >["onRespondToApproval"];
}

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const { t } = useMobileI18n();

  const defaultOptions = [
    { decision: "accept", label: t("Allow once") },
    { decision: "acceptForSession", label: t("Allow session") },
    { decision: "decline", label: t("Decline") },
  ] satisfies ReadonlyArray<ProviderApprovalOption>;

  const feedbackOptions = [
    { decision: "decline", label: t("Cancel") },
  ] satisfies ReadonlyArray<ProviderApprovalOption>;

  const isProductFeedback = props.approval.toolName === ISNADI_PRODUCT_FEEDBACK_TOOL_NAME;

  // A routine approval shows what the bot proposes, so it is never approved blind.
  const routine =
    props.approval.toolName === ISNADI_CREATE_ROUTINE_TOOL_NAME
      ? routineApprovalSummary(props.approval.args, t)
      : null;

  const options = isProductFeedback ? feedbackOptions : (props.approval.options ?? defaultOptions);

  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-3xl border border-border bg-card-alt p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-label-wide text-info-foreground">
        {t("Approval needed")}
      </Text>
      <Text className="font-t3-bold text-lg text-foreground">
        {isProductFeedback
          ? t("Product feedback")
          : routine
            ? t("Review routine")
            : (props.approval.appName ?? props.approval.requestKind)}
      </Text>
      {routine ? (
        <View className="gap-1">
          <Text className="font-t3-bold text-base text-foreground">{routine.name}</Text>
          {routine.schedule ? (
            <Text className="font-sans text-sm text-foreground-secondary">{routine.schedule}</Text>
          ) : null}
          {routine.instructions ? (
            <Text className="font-sans text-sm leading-normal text-foreground-secondary">
              {routine.instructions}
            </Text>
          ) : null}
        </View>
      ) : props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {isProductFeedback
            ? t("Open IsnadiBot on web or desktop to review this feedback draft.")
            : props.approval.detail}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2.5">
        {options.map((option) => (
          <Pressable
            key={option.decision}
            className={`items-center justify-center rounded-2xl px-3.5 py-3 ${Match.value(
              option.decision,
            ).pipe(
              Match.when("accept", () => "bg-primary"),
              Match.when("decline", () => "bg-danger"),
              Match.orElse(() => "bg-subtle-strong"),
            )}`}
            disabled={props.respondingApprovalId === props.approval.requestId}
            onPress={() => void props.onRespond(props.approval.requestId, option.decision)}
          >
            <Text
              className={`text-sm ${Match.value(option.decision).pipe(
                Match.when("accept", () => "font-t3-extrabold text-primary-foreground"),
                Match.when("decline", () => "font-t3-bold text-danger-foreground"),
                Match.orElse(() => "font-t3-bold text-foreground"),
              )}`}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
