import { Alert } from "react-native";

import { translateOutsideReact } from "./i18n";

/**
 * An alert whose body is the app's own sentence. `details` is the raw text the environment or a
 * native module reported: it is not in the interface language, so it sits behind a "Show details"
 * button instead of inline. An alert has no room for a disclosure of its own, so the button opens
 * a second alert.
 */
export function alertWithDetails(title: string, message: string, details: string | null): void {
  if (details === null || details.trim().length === 0) {
    Alert.alert(title, message);

    return;
  }

  Alert.alert(title, message, [
    {
      text: translateOutsideReact("Show details"),
      onPress: () => Alert.alert(translateOutsideReact("Show details"), details),
    },
    { text: translateOutsideReact("Dismiss"), style: "cancel" },
  ]);
}
