import * as Cause from "effect/Cause";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@isnadi/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * `requireThread`, `requireThreadNotArchived` and `requireThreadArchived` are
 * the guard chain every thread command passes, so a stale thread id used to
 * print the server's invariant sentence — id and all — in the toast the user
 * reads. Web already routes these failures through `commandFailureMessage`
 * (TASK-269), so this file pins what the coded throws unlock: each case drives
 * the real action and asserts the toast DESCRIPTION.
 */
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  archive: vi.fn(),
  unarchive: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("~/test/reactHookHarness");

  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useMemo: reactHookHarness.useMemo,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("~/test/reactHookHarness");

  return { c: reactHookHarness.useMemoCache };
});

vi.mock("~/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

vi.mock("~/components/ui/toast", () => ({ toastManager: { add: mocks.toast } }));

vi.mock("~/components/roster/rosterStore", () => ({
  useRosterStore: {
    getState: () => ({ chatPathByBotId: {}, forgetChatPath: vi.fn() }),
  },
}));

vi.mock("~/lib/archivedThreadsState", () => ({
  refreshArchivedThreadsForEnvironment: vi.fn(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ dialogs: { confirm: () => Promise.resolve(true) } }),
}));

vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsPinReorder: () => false,
  readThreadShell: () => null,
  readThreadShells: () => [],
}));

vi.mock("~/state/threads", () => ({
  threadEnvironment: {
    archive: "archive",
    delete: "delete",
    pin: "pin",
    settle: "settle",
    snooze: "snooze",
    stopSession: "stopSession",
    unarchive: "unarchive",
    unpin: "unpin",
    unsettle: "unsettle",
    unsnooze: "unsnooze",
    updateMetadata: "updateMetadata",
  },
}));

vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: string) => (command === "unarchive" ? mocks.unarchive : mocks.archive),
}));

vi.mock("~/uiStateStore", () => ({ useUiStateStore: () => vi.fn() }));

vi.mock("./useSettings", () => ({ useClientSettings: () => false }));

import { reactHookHarness } from "~/test/reactHookHarness";
import { useChatActions } from "./useChatActions";

const threadRef: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-7f3a"),
};

/** A failed command carrying one refusal code and the server's own sentence. */
const failedCommand = (refusal: string, message: string) => ({
  _tag: "Failure" as const,
  cause: Cause.fail({ _tag: "OrchestrationCommandInvariantError", message, refusal }),
});

const actions = () => {
  reactHookHarness.beginRender();

  return useChatActions();
};

/** The toast the failed action raised. */
const toast = () => mocks.toast.mock.calls[0]?.[0] as { title: string; description: string };

beforeEach(() => {
  reactHookHarness.reset();
  mocks.toast.mockReset();
  mocks.archive.mockReset();
  mocks.unarchive.mockReset();
});

describe("web chat actions against a stale thread", () => {
  it("archiving a chat another device already removed names why, not the thread id", async () => {
    mocks.archive.mockResolvedValue(
      failedCommand(
        "stale-view",
        "Thread 'thread-7f3a' does not exist for command 'thread.archive'.",
      ),
    );

    const archived = await actions().archive(threadRef);

    expect(archived).toBe(false);
    expect(toast().title).toBe("Could not archive chat");
    expect(toast().description).toBe("Something here has changed. Refresh to see the latest.");
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("archiving a chat another device already archived names why", async () => {
    mocks.archive.mockResolvedValue(
      failedCommand(
        "entity-archived",
        "Thread 'thread-7f3a' is already archived and cannot handle command 'thread.archive'.",
      ),
    );

    const archived = await actions().archive(threadRef);

    expect(archived).toBe(false);
    expect(toast().description).toBe("It is archived. Restore it first, then try again.");
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("restoring a chat another device already restored names why", async () => {
    mocks.unarchive.mockResolvedValue(
      failedCommand(
        "stale-view",
        "Thread 'thread-7f3a' is not archived for command 'thread.unarchive'.",
      ),
    );

    const restored = await actions().unarchive(threadRef);

    expect(restored).toBe(false);
    expect(toast().title).toBe("Could not unarchive chat");
    expect(toast().description).toBe("Something here has changed. Refresh to see the latest.");
    expect(toast().description).not.toContain("thread-7f3a");
  });
});
