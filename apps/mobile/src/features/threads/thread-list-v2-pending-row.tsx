import { useMobileI18n } from "../../lib/i18n";
import type { EnvironmentProject } from "@isnadi/client-runtime/state/shell";
import type { MenuAction } from "@react-native-menu/menu";
import { memo, useCallback } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { ControlPillMenu } from "../../components/ControlPill";
import { useThemeColor } from "../../lib/useThemeColor";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { useQueuedMessageFailureActions } from "../../state/use-queued-message-failure-actions";
import { QueuedMessageFailureNotice } from "./QueuedMessageFailureNotice";
import { MONO_FONT, SIDEBAR_V2_ROW_RADIUS } from "./thread-list-v2-presentation";
import { ThreadListV2SectionDivider } from "./thread-list-v2-shelves";

const PENDING_TASK_MENU_ACTIONS: MenuAction[] = [
  { id: "delete", title: "Delete", image: "trash", attributes: { destructive: true } },
];

/**
 * A queued new task, in the same idiom as an active v2 row: it is work the
 * user wrote, so it reads like the threads it will become. "Queued" takes
 * the status slot — the state is the one thing that differs — and stays
 * uncolored because nothing is asked of the user; the environment is simply
 * not reachable yet.
 */
export const ThreadListV2PendingRow = memo(function ThreadListV2PendingRow(props: {
  readonly pendingTask: PendingNewTask;
  readonly project: EnvironmentProject | null;
  readonly projectTitle?: string;
  readonly environmentLabel: string | null;
  readonly pane?: "screen" | "sidebar";
  /** Draws the "Pending" divider above the first queued row. */
  readonly showPendingDivider: boolean;
  /** Keeps row hairlines inside a section; section headers draw their own rule. */
  readonly showTrailingDivider?: boolean;
  readonly onSelectPendingTask: (pendingTask: PendingNewTask) => void;
  readonly onDeletePendingTask: (pendingTask: PendingNewTask) => void;
}) {
  const { t } = useMobileI18n();
  const { pendingTask, onSelectPendingTask, onDeletePendingTask } = props;
  const { retryQueuedMessage } = useQueuedMessageFailureActions();
  const drawerColor = useThemeColor("--color-drawer");
  const pressedBackgroundColor = useThemeColor("--color-subtle");
  const sidebarPane = props.pane === "sidebar";

  const failure = pendingTask.message.failure;

  const projectTitle =
    props.projectTitle ?? props.project?.title ?? pendingTask.creation.projectTitle ?? "";

  const branch = pendingTask.creation.branch;

  const handleMenuAction = useCallback(
    ({ nativeEvent }: { readonly nativeEvent: { readonly event: string } }) => {
      if (nativeEvent.event === "delete") onDeletePendingTask(pendingTask);
    },
    [onDeletePendingTask, pendingTask],
  );

  const rowContent = (
    <>
      <Text className="text-lg font-t3-medium leading-snug text-foreground" numberOfLines={1}>
        {pendingTask.title}
      </Text>
      <Text className="mt-1 text-xs text-foreground-muted" numberOfLines={1}>
        {failure ? (
          <Text className="text-danger-foreground">{t("Not sent")}</Text>
        ) : (
          <Text className="text-foreground-muted">{t("Queued")}</Text>
        )}
        {projectTitle ? `  ·  ${projectTitle}` : ""}
        {branch ? (
          <Text className="text-xs text-foreground-muted" style={{ fontFamily: MONO_FONT }}>
            {`  ·  ${branch}`}
          </Text>
        ) : null}
        {props.environmentLabel ? (
          <Text className="text-xs text-foreground-tertiary">
            {`  ·  ${props.environmentLabel}`}
          </Text>
        ) : null}
      </Text>
    </>
  );

  return (
    <>
      {props.showPendingDivider ? (
        <ThreadListV2SectionDivider label={t("Pending")} pane={props.pane} />
      ) : null}
      <ControlPillMenu
        actions={PENDING_TASK_MENU_ACTIONS}
        onPressAction={handleMenuAction}
        shouldOpenOnLongPress
      >
        <Pressable
          accessibilityHint={t("Opens the queued chat for editing")}
          accessibilityLabel={pendingTask.title}
          accessibilityRole="button"
          onPress={() => onSelectPendingTask(pendingTask)}
          style={
            sidebarPane
              ? ({ pressed }) => ({
                  backgroundColor: pressed ? pressedBackgroundColor : drawerColor,
                  borderRadius: SIDEBAR_V2_ROW_RADIUS,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                })
              : ({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })
          }
        >
          {sidebarPane ? (
            rowContent
          ) : (
            <View className="bg-screen">
              <View className="px-5 py-3">{rowContent}</View>
            </View>
          )}
        </Pressable>
      </ControlPillMenu>
      {failure ? (
        <QueuedMessageFailureNotice
          className={sidebarPane ? "mx-3 mb-2" : "mx-5 mb-3"}
          failure={failure}
          messageText={pendingTask.message.text}
          onDiscard={() => onDeletePendingTask(pendingTask)}
          onRetry={() => {
            void retryQueuedMessage(pendingTask.message);
          }}
        />
      ) : null}
    </>
  );
});
