import * as Schema from "effect/Schema";
import { ComputerSession, ComputerState, type ThreadId } from "@isnadi/contracts";
import type { ComputerViewerPort } from "@isnadi/client-runtime/state/computer-viewer-controller";

const decodeSession = Schema.decodeUnknownSync(ComputerSession);

const decodeState = Schema.decodeUnknownSync(ComputerState);

const FIXTURE_SESSION_ID = "fixture-session";

const FIXTURE_LEASE_MS = 60_000;

/**
 * A fake computer behind the real viewer port. It models the only fact the screens depend on —
 * who owns the desktop — so taking control, giving back, stopping and resuming behave as they do
 * against the server, without one.
 */
export function createFixtureComputerPort(threadId: ThreadId): ComputerViewerPort {
  let status: "ready" | "human" | "stopped" = "ready";

  const state = (): ComputerState =>
    decodeState({
      threadId,
      status,
      capability: "desktop",
      controlAvailable: true,
      reason: null,
      workspaceId: "fixture",
    });

  return {
    getState: async () => ({ ok: true, value: state() }),
    open: async () => {
      if (status === "stopped") status = "ready";

      return { ok: true, value: state() };
    },
    acquire: async () => {
      status = "human";

      return {
        ok: true,
        value: decodeSession({
          sessionId: FIXTURE_SESSION_ID,
          expiresAt: Date.now() + FIXTURE_LEASE_MS,
          state: state(),
        }),
      };
    },
    input: async () => ({ ok: true, value: undefined }),
    release: async () => {
      status = "ready";

      return { ok: true, value: state() };
    },
    close: async () => {
      if (status === "human") status = "ready";

      return { ok: true, value: state() };
    },
    stop: async () => {
      status = "stopped";

      return { ok: true, value: state() };
    },
  };
}
