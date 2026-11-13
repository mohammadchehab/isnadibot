import * as Schema from "effect/Schema";
import { ComputerEvent, type ThreadId } from "@isnadi/contracts";
import {
  deriveComputerViewer,
  type ComputerViewerState,
} from "@isnadi/client-runtime/state/computer-viewer";
import {
  createComputerViewerController,
  type ComputerViewerController,
} from "@isnadi/client-runtime/state/computer-viewer-controller";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { createFixtureComputerPort } from "./fixtureComputer";
import { FIXTURE_COMPUTER_FRAMES } from "./fixtureComputerFrames";

/** How often the fixture desktop repaints while the viewer is streaming. */
const FIXTURE_FRAME_INTERVAL_MS = 1_000;

const FRAME_EVENT_TAG = "frame";

const decodeComputerEvent = Schema.decodeUnknownSync(ComputerEvent);

export interface FixtureComputerViewerHandle {
  readonly controller: ComputerViewerController;
  readonly state: ComputerViewerState;
  readonly view: ReturnType<typeof deriveComputerViewer>;
}

/**
 * The live view on fixture frames: the same controller and reducer the server-backed viewer uses,
 * with a fake computer standing in for `computer.*`. It exists so the watch, take control, give
 * back, stopped and paused screens can be walked through before the RPC wiring lands.
 */
export function useFixtureComputerViewer(threadId: ThreadId): FixtureComputerViewerHandle {
  const controller = useMemo(
    () => createComputerViewerController({ port: createFixtureComputerPort(threadId) }),
    [threadId],
  );

  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  // A live frame every second while the viewer is streaming, so the screen moves like the real one.
  const streaming = state.visible;
  useEffect(() => {
    if (!streaming) return;

    let index = 0;

    const timer = setInterval(() => {
      const frame = FIXTURE_COMPUTER_FRAMES[index % FIXTURE_COMPUTER_FRAMES.length];

      index += 1;

      // A fixture frame still goes through the contract, so it cannot drift from what the
      // server actually sends.
      if (frame !== undefined)
        controller.receive(decodeComputerEvent({ _tag: FRAME_EVENT_TAG, frame }));
    }, FIXTURE_FRAME_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [controller, streaming]);

  const view = useMemo(() => deriveComputerViewer(state), [state]);

  return { controller, state, view };
}
