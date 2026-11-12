import type { ComputerFrame } from "@isnadi/contracts";
import { useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";

import {
  initialComputerViewerCover,
  reduceComputerViewerCover,
  type ComputerViewerCover,
} from "@isnadi/client-runtime/state/computer-viewer-cover";

/**
 * Feeds AppState and incoming frames to the shared cover reducer. Frames carry no timestamp, so
 * the cover counts them: "newer than the pre-cover frame" is a higher count.
 */
export function useComputerViewerCover(frame: ComputerFrame | null): ComputerViewerCover {
  const [cover, dispatchCover] = useReducer(reduceComputerViewerCover, initialComputerViewerCover);
  const frameCount = useRef(0);
  const lastFrame = useRef(frame);

  if (frame !== lastFrame.current) {
    lastFrame.current = frame;

    if (frame !== null) frameCount.current += 1;
  }

  const latestFrameCount = frameCount.current;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active" || status === "inactive" || status === "background") {
        dispatchCover({ type: "app-state", status, lastFrameAt: frameCount.current });
      }
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (frame !== null) dispatchCover({ type: "frame", at: latestFrameCount });
  }, [frame, latestFrameCount]);

  return cover;
}
