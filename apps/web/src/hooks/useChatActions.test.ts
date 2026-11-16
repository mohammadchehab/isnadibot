import * as Cause from "effect/Cause";
import { EnvironmentId, ThreadId, type ScopedThreadRef } from "@isnadi/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * Web already routes every chat lifecycle failure through the shared
 * `commandFailureMessage` helper (TASK-269), so this file does not change the
 * call site — it pins the behaviour the coded throws now unlock. Each case
 * drives the real action and asserts the toast DESCRIPTION, the line the user
 * reads, which used to be the server's invariant sentence with the thread id in
 * it.
 */
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  settle: vi.fn(),
  snooze: vi.fn(),
  pin: vi.fn(),
  archive: vi.fn(),
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
  useAtomCommand: (command: string) => {
    switch (command) {
      case "settle":
        return mocks.settle;
      case "snooze":
        return mocks.snooze;
      case "pin":
        return mocks.pin;
      default:
        return mocks.archive;
    }
  },
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
  mocks.settle.mockReset();
  mocks.snooze.mockReset();
  mocks.pin.mockReset();
});

describe("web chat actions", () => {
  it("settling a chat with work in flight names why, not the thread id", async () => {
    mocks.settle.mockResolvedValue(
      failedCommand(
        "thread-is-busy",
        "thread thread-7f3a has an active session and cannot be settled",
      ),
    );

    const settled = await actions().settle(threadRef);

    expect(settled).toBe(false);
    expect(toast().title).toBe("Could not settle chat");
    expect(toast().description).toBe(
      "This chat has work in flight. Wait for it to finish, or respond to it.",
    );
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("pinning a chat whose state moved on names why, not the thread id", async () => {
    mocks.pin.mockResolvedValue(
      failedCommand(
        "thread-state-invalid",
        "thread thread-7f3a is not pinned and cannot be reordered",
      ),
    );

    const pinned = await actions().pin(threadRef);

    expect(pinned).toBe(false);
    expect(toast().description).toBe(
      "That action does not fit this chat's current state. Refresh and try again.",
    );
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("snoozing a chat that is waiting on the user names why", async () => {
    mocks.snooze.mockResolvedValue(
      failedCommand(
        "thread-is-busy",
        "thread thread-7f3a has a pending approval or user-input request and cannot be snoozed",
      ),
    );

    await actions().snooze(threadRef, "2026-01-02T00:00:00.000Z");

    expect(toast().title).toBe("Could not snooze chat");
    expect(toast().description).toBe(
      "This chat has work in flight. Wait for it to finish, or respond to it.",
    );
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("says its own sentence for a refusal code it does not know", async () => {
    // A newer server's code: the refusal vocabulary is the server's, so a code
    // this build cannot name is not news it can word. The surface says its own
    // line rather than printing the server's sentence. TASK-384 AC4 supersedes
    // TASK-287's unknown-code fallback here.
    mocks.settle.mockResolvedValue(
      failedCommand("thread-state-unheard-of", "Thread 'thread-7f3a' history already matches."),
    );

    await actions().settle(threadRef);

    expect(toast().description).toBe("An unexpected error occurred.");
    expect(toast().description).not.toContain("thread-7f3a");
  });

  it("stays quiet when the command lands", async () => {
    mocks.settle.mockResolvedValue({ _tag: "Success" as const, value: undefined });

    const settled = await actions().settle(threadRef);

    expect(settled).toBe(true);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
});
