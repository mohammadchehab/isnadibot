import { useEffect } from "react";
import { Platform } from "react-native";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";

/**
 * Scopes the block to the live view. A prevent without its matching allow would leave screenshots
 * blocked for the rest of the session, so the key is what the unmount clears.
 */
const LIVE_VIEW_CAPTURE_KEY = "computer-live-view";

/**
 * Android takes the recents thumbnail before JavaScript can draw the cover, so the only thing that
 * keeps a live frame out of it is the window's FLAG_SECURE. iOS has no screenshot block and its
 * app-switcher picture is drawn from `AppState` (`useComputerViewerCover`), so nothing is set
 * there; expo-screen-capture would blank the view in iOS screenshots and recordings, which is not
 * what the live view promises.
 */
export function captureBlockFor(platform: string): "prevent" | "none" {
  return platform === "android" ? "prevent" : "none";
}

/**
 * Sets FLAG_SECURE for exactly as long as the live view is mounted. Call it from the screen that
 * owns the viewer, not from a component that stays mounted behind it.
 */
export function useLiveViewCaptureBlock(): void {
  useEffect(() => {
    if (captureBlockFor(Platform.OS) === "none") return undefined;

    void preventScreenCaptureAsync(LIVE_VIEW_CAPTURE_KEY);

    return () => {
      void allowScreenCaptureAsync(LIVE_VIEW_CAPTURE_KEY);
    };
  }, []);
}
