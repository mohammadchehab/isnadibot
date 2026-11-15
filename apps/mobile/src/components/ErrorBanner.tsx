import { useState } from "react";
import { Pressable, View } from "react-native";

import { useMobileI18n } from "../lib/i18n";
import { AppText as Text } from "./AppText";

/**
 * A "Show details" disclosure for the raw text a failure carried. It is not in the interface
 * language, so it stays closed until the user asks for it.
 */
export function ErrorDetailsDisclosure(props: {
  readonly details: string;
  readonly labelClassName: string;
  readonly panelClassName: string;
  readonly className?: string;
}) {
  const { t } = useMobileI18n();
  const [open, setOpen] = useState(false);

  return (
    <View className={props.className}>
      <Pressable
        accessibilityRole="button"
        className="self-start py-0.5"
        onPress={() => setOpen((wasOpen) => !wasOpen)}
      >
        <Text className={props.labelClassName}>{open ? t("Hide details") : t("Show details")}</Text>
      </Pressable>
      {open ? (
        <Text selectable className={props.panelClassName}>
          {props.details}
        </Text>
      ) : null}
    </View>
  );
}

const BANNER_DETAILS_LABEL = "font-t3-medium text-xs text-danger-foreground";

// The panel is a code surface, not a second alarm: it takes the neutral subtle
// fill so the raw text reads as machine output sitting inside the banner rather
// than as a louder version of it. Web's ThreadErrorBanner draws the same
// distinction with `bg-muted/60` and `text-foreground/75`.
const BANNER_DETAILS_PANEL =
  "mt-1 rounded-lg border border-danger-border bg-subtle px-2.5 py-2 font-mono text-xs leading-5 text-foreground-secondary";

/**
 * A failure banner. `message` is the app's own sentence, which every catalogue carries; `details`
 * is the raw text the environment or a native module reported.
 */
export function ErrorBanner(props: { readonly message: string; readonly details?: string }) {
  const hasDetails = props.details !== undefined && props.details.trim().length > 0;

  return (
    <View className="rounded-2xl border border-danger-border bg-danger px-3.5 py-3">
      <Text className="font-t3-medium text-sm text-danger-foreground">{props.message}</Text>
      {hasDetails ? (
        <ErrorDetailsDisclosure
          className="mt-1.5"
          details={props.details ?? ""}
          labelClassName={BANNER_DETAILS_LABEL}
          panelClassName={BANNER_DETAILS_PANEL}
        />
      ) : null}
    </View>
  );
}
