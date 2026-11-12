import { Predicate } from "effect";
import { RegistryContext } from "@effect/atom-react";
import {
  deriveComputerViewer,
  type ComputerViewerState,
} from "@isnadi/client-runtime/state/computer-viewer";
import {
  applyUnavailableRecheck,
  computerViewerOutcome,
  createComputerViewerController,
  type ComputerViewerController,
} from "@isnadi/client-runtime/state/computer-viewer-controller";
import { shouldShowComputerFrame } from "@isnadi/client-runtime/state/computer-viewer-cover";
import { COMPUTER_SESSION_TTL_MS, type ScopedThreadRef } from "@isnadi/contracts";
import { useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { computerEnvironment } from "../../state/computer";
import { useComputerViewerCover } from "./useComputerViewerCover";
import { useEnvironmentConnectionState } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";

/** How often an open viewer asks again for a computer that has not started yet. */
const UNAVAILABLE_RECHECK_MS = 5_000;

export interface ComputerViewerHandle {
  readonly controller: ComputerViewerController;
  readonly state: ComputerViewerState;
  readonly view: ReturnType<typeof deriveComputerViewer>;
  /** False while the privacy cover hides the frame (app switcher, or just back from background). */
  readonly showFrame: boolean;
}

/**
 * Runs one computer viewer for a thread. The stream is held only while the viewer is open and the
 * app is not in the background; going to the background closes it and hands control back to the
 * bot. "inactive" (the app switcher snapshot) covers the frame without ending the stream.
 */
export function useComputerViewer(threadRef: ScopedThreadRef, open: boolean): ComputerViewerHandle {
  const registry = useContext(RegistryContext);
  const commandOptions = { reportFailure: false, reportDefect: false } as const;
  const getState = useAtomQueryRunner(computerEnvironment.state, commandOptions);
  const openComputer = useAtomCommand(computerEnvironment.open, commandOptions);
  const acquire = useAtomCommand(computerEnvironment.acquire, commandOptions);
  const input = useAtomCommand(computerEnvironment.input, commandOptions);
  const release = useAtomCommand(computerEnvironment.release, commandOptions);
  const close = useAtomCommand(computerEnvironment.close, commandOptions);
  const stop = useAtomCommand(computerEnvironment.stop, commandOptions);

  const { environmentId, threadId } = threadRef;

  const eventsAtom = useMemo(
    () => computerEnvironment.events({ environmentId, input: { threadId } }),
    [environmentId, threadId],
  );

  const [streamEpoch, setStreamEpoch] = useState(0);
  const resubscribe = useCallback(() => setStreamEpoch((epoch) => epoch + 1), []);

  const controller = useMemo(() => {
    const target = { environmentId, input: { threadId } };

    return createComputerViewerController({
      port: {
        getState: async () => computerViewerOutcome(await getState(target)),
        open: async () => computerViewerOutcome(await openComputer(target)),
        acquire: async () => computerViewerOutcome(await acquire(target)),
        input: async (next) =>
          computerViewerOutcome(await input({ environmentId, input: { threadId, ...next } })),
        release: async (sessionId) =>
          computerViewerOutcome(await release({ environmentId, input: { threadId, sessionId } })),
        close: async () => computerViewerOutcome(await close(target)),
        stop: async () => computerViewerOutcome(await stop(target)),
      },
      onReopened: resubscribe,
    });
  }, [
    acquire,
    close,
    environmentId,
    getState,
    input,
    openComputer,
    release,
    resubscribe,
    stop,
    threadId,
  ]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  const cover = useComputerViewerCover(state.frame);
  const visible = open && cover.streaming;

  useEffect(() => {
    if (!visible) return;
    void controller.show();

    return () => {
      void controller.hide();
    };
  }, [controller, visible]);

  const connection = useEnvironmentConnectionState(environmentId).data;
  const connected = connection === null || connection.phase === "connected";
  useEffect(() => {
    controller.dispatch({ type: "connection", connected });
  }, [connected, controller]);

  // A computer can start after the viewer opens, and events only exist for a
  // registered computer, so an open viewer rechecks until one appears.
  const unavailable = visible && connected && state.server?.status === "unavailable";
  useEffect(() => {
    if (!unavailable) return;
    let active = true;

    const timer = setInterval(() => {
      void getState({ environmentId, input: { threadId } }).then((outcome) => {
        const next = computerViewerOutcome(outcome);

        if (active && next.ok) applyUnavailableRecheck(controller, next.value);
      });
    }, UNAVAILABLE_RECHECK_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [controller, environmentId, getState, threadId, unavailable]);

  // Follow the event stream only while someone is watching. The stream ends
  // when the computer stops; resuming bumps the epoch to subscribe again.
  const status = state.server?.status ?? null;
  const streamable = visible && connected && status !== "stopped" && status !== "unavailable";
  useEffect(() => {
    if (!streamable) return;

    if (streamEpoch > 0) registry.refresh(eventsAtom);

    return registry.subscribe(
      eventsAtom,
      (result) => {
        if (Predicate.isTagged(result, "Success")) controller.receive(result.value);
        else if (Predicate.isTagged(result, "Failure")) {
          void getState({ environmentId, input: { threadId } }).then((outcome) => {
            const next = computerViewerOutcome(outcome);

            if (next.ok) controller.dispatch({ type: "server-state", state: next.value });
          });
        }
      },
      { immediate: true },
    );
  }, [
    controller,
    environmentId,
    eventsAtom,
    getState,
    registry,
    streamEpoch,
    streamable,
    threadId,
  ]);

  // The lease cannot be renewed. Time it on this device's clock from when it
  // was granted, so clock skew with a remote server cannot end it early.
  const lease = state.lease;
  const leaseId = lease?.sessionId ?? null;
  const leaseExpiresAt = lease?.expiresAt ?? null;
  useEffect(() => {
    if (leaseId === null || leaseExpiresAt === null) return;

    const timer = setTimeout(
      () => controller.dispatch({ type: "tick", now: leaseExpiresAt }),
      COMPUTER_SESSION_TTL_MS,
    );

    return () => clearTimeout(timer);
  }, [controller, leaseExpiresAt, leaseId]);

  const view = useMemo(() => deriveComputerViewer(state), [state]);

  return { controller, state, view, showFrame: shouldShowComputerFrame(cover) };
}
