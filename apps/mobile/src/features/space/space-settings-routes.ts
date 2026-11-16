import type { EnvironmentId, GroupId } from "@isnadi/contracts";
import { Platform } from "react-native";

/**
 * What the space settings pushes need: the space, and the environment that
 * holds it. Both routes are pushed inside the chat settings sheet, so the
 * phone reaches them from a chat's own settings rather than a space list.
 */
export type SpaceSettingsRouteParams = {
  readonly environmentId: EnvironmentId;
  readonly groupId: GroupId;
};

/**
 * Android draws its own in-flow header (AndroidScreenHeader in each screen);
 * the native stack header stays iOS-only, as in the rest of the sheet.
 */
export const SPACE_SETTINGS_HEADER_OPTIONS = { headerShown: Platform.OS !== "android" };
