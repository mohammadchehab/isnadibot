import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import type { ThreadId } from "@isnadi/contracts";
import { useEffect, useRef } from "react";

import { ComputerViewerScreen } from "./ComputerViewerScreen";
import { useComputerViewerCover } from "./useComputerViewerCover";
import { useFixtureComputerViewer } from "./useFixtureComputerViewer";

export type ComputerViewerRouteParams = {
  readonly threadId: ThreadId;
  readonly botName: string;
};

/**
 * The live view for one thread, on fixture frames until the RPC wiring lands (decision-53). The
 * phases, the notices and the privacy cover are the real ones.
 */
export function ComputerViewerRouteScreen({ route }: StaticScreenProps<ComputerViewerRouteParams>) {
  const navigation = useNavigation();
  const { controller, state, view } = useFixtureComputerViewer(route.params.threadId);
  const cover = useComputerViewerCover(state.frame);

  const frameKey = useRef(0);
  const countedFrame = useRef(state.frame);

  if (state.frame !== countedFrame.current) {
    countedFrame.current = state.frame;

    if (state.frame !== null) frameKey.current += 1;
  }

  // The viewer holds the stream only while the app is in the foreground; going to the background
  // closes it and hands control back to the bot, so the paused screen shows on return.
  const watching = cover.streaming;

  useEffect(() => {
    if (!watching) {
      void controller.hide();

      return;
    }

    void controller.show();
  }, [controller, watching]);

  return (
    <ComputerViewerScreen
      botName={route.params.botName}
      view={view}
      frame={state.frame}
      frameKey={frameKey.current}
      notice={state.notice}
      showFrame={!cover.covered}
      onTakeControl={() => void controller.takeControl()}
      onReturnControl={() => void controller.returnControl()}
      onResume={() => {
        // Paused: reopen the stream on a computer that is still running. Stopped: ask the server
        // to start it again, which is the only case `resume` covers.
        if (view.phase === "hidden") void controller.show();
        else void controller.resume();
      }}
      onClose={() => navigation.goBack()}
    />
  );
}
