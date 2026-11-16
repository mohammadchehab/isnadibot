import { type ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useMobileI18n } from "../../lib/i18n";

/**
 * The bottom sheet both skills flows open into: a dimmed scrim that closes on tap, a rounded
 * panel pinned to the bottom edge, the frame's grabber and title block, a scrolling body, and a
 * footer the caller fills. It is drawn only while open, so the caller mounts it on demand.
 */
export function SkillSheet({
  title,
  subtitle,
  children,
  footer,
  onClose,
}: {
  readonly title: string;
  readonly subtitle?: string | undefined;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  readonly onClose: () => void;
}) {
  const { t } = useMobileI18n();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Close")}
          className="absolute inset-0 bg-backdrop"
          onPress={onClose}
        />
        <View
          className="gap-3 rounded-t-2xl bg-card px-4 pt-2"
          style={{ maxHeight: "90%", paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="h-1 w-9 self-center rounded-full bg-border-subtle" />
          <View className="gap-0.5">
            <Text className="text-lg font-t3-bold text-foreground">{title}</Text>
            {subtitle === undefined ? null : (
              <Text className="text-3xs text-foreground-muted">{subtitle}</Text>
            )}
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            className="shrink"
            contentContainerClassName="gap-3"
          >
            {children}
          </ScrollView>
          <View className="pt-1">{footer}</View>
        </View>
      </View>
    </Modal>
  );
}

/** A group label inside a sheet: the small-caps heading the registry screen uses for its groups. */
export function SkillSheetLabel({ children }: { readonly children: string }) {
  return (
    <Text className="text-3xs font-t3-bold tracking-label text-foreground-muted">{children}</Text>
  );
}

/** A quiet line under a group: what the sheet does not do, or what approving commits to. */
export function SkillSheetNote({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}) {
  return <Text className={cn("text-3xs text-foreground-muted", className)}>{children}</Text>;
}

/** The sheet's primary action, in the same pair the Skills screen's footer button uses. */
export function SkillSheetPrimary({
  label,
  disabled = false,
  onPress,
  className,
}: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={cn(
        "h-9 items-center justify-center rounded-lg bg-foreground",
        disabled && "opacity-50",
        className,
      )}
      disabled={disabled}
      onPress={onPress}
    >
      <Text className="text-sm font-t3-medium text-background">{label}</Text>
    </Pressable>
  );
}

/** The sheet's way out, in the secondary pair a row action uses. */
export function SkillSheetSecondary({
  label,
  onPress,
  className,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={cn("h-9 items-center justify-center rounded-lg bg-secondary", className)}
      onPress={onPress}
    >
      <Text className="text-sm font-t3-medium text-secondary-foreground">{label}</Text>
    </Pressable>
  );
}
