import type { ComputerFrame } from "@isnadi/contracts";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";

/**
 * Holds the newest value and commits it at most once per animation frame, so a burst of frames
 * cannot queue renders. The first value renders immediately.
 */
function useOncePerAnimationFrame<T>(value: T): T {
  const [committed, setCommitted] = useState(value);
  const latest = useRef(value);

  latest.current = value;

  useEffect(() => {
    const handle = requestAnimationFrame(() => setCommitted(latest.current));

    return () => cancelAnimationFrame(handle);
  }, [value]);

  return committed;
}

interface ComputerFrameViewProps {
  readonly frame: ComputerFrame;
  /** Counts frames; changes with every frame so the native view never recycles a stale bitmap. */
  readonly frameKey: number;
}

/**
 * Draws one computer frame from memory only: a data uri with `cachePolicy="none"`, so nothing is
 * written to the image disk cache. Frames are size-checked by the schema at decode, not here.
 */
export function ComputerFrameView({ frame, frameKey }: ComputerFrameViewProps) {
  const shown = useOncePerAnimationFrame({ frame, frameKey });

  return (
    <Image
      source={{ uri: `data:${shown.frame.mimeType};base64,${shown.frame.data}` }}
      cachePolicy="none"
      recyclingKey={String(shown.frameKey)}
      contentFit="contain"
      style={{ width: "100%", aspectRatio: shown.frame.width / shown.frame.height }}
    />
  );
}
