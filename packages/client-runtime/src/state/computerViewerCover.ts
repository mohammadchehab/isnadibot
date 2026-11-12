/**
 * Privacy cover for the mobile live view. The app switcher snapshots the screen on "inactive",
 * so the frame is hidden at once; "background" also ends the stream (hiding the viewer releases
 * the lease). On return the cover stays until a frame newer than the last one seen before the
 * cover arrives, so a stale pre-cover frame never flashes back.
 */
export type ComputerViewerAppStatus = "active" | "inactive" | "background";

export interface ComputerViewerCover {
  readonly covered: boolean;
  readonly streaming: boolean;
  readonly active: boolean;
  /** Frame time the next frame must exceed before the cover lifts; null when there was none. */
  readonly staleAt: number | null;
}

export type ComputerViewerCoverEvent =
  | {
      readonly type: "app-state";
      readonly status: ComputerViewerAppStatus;
      readonly lastFrameAt: number | null;
    }
  | { readonly type: "frame"; readonly at: number };

export const initialComputerViewerCover: ComputerViewerCover = {
  covered: false,
  streaming: true,
  active: true,
  staleAt: null,
};

export function reduceComputerViewerCover(
  state: ComputerViewerCover,
  event: ComputerViewerCoverEvent,
): ComputerViewerCover {
  if (event.type === "frame") {
    if (!state.active || !state.covered) return state;

    if (state.staleAt !== null && event.at <= state.staleAt) return state;

    return { ...state, covered: false, staleAt: null };
  }

  if (event.status === "active") {
    if (state.active) return state;

    return { covered: true, streaming: true, active: true, staleAt: state.staleAt };
  }

  return {
    covered: true,
    streaming: event.status === "inactive" ? state.streaming : false,
    active: false,
    staleAt: state.active ? event.lastFrameAt : state.staleAt,
  };
}

export function shouldShowComputerFrame(state: ComputerViewerCover): boolean {
  return !state.covered;
}
