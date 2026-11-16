import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationSession,
} from "@isnadi/contracts";
import type { EnvironmentThreadShell } from "@isnadi/client-runtime/state/shell";
import * as Cause from "effect/Cause";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The mobile surfaces for settle, snooze, pin and unpin used to echo
 * `error.message`, so a refusal showed the server's invariant sentence with the
 * thread id in it. Each case below drives the real control and asserts the alert
 * DESCRIPTION, which is the line the user reads.
 *
 * The mocks keep the hook pure: `react` returns its callbacks directly, the
 * translator is the identity so a description equals its catalog key, and the
 * command is a spy whose failure each case supplies.
 */
const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  command: vi.fn(),
}));

vi.mock("react", () => ({
  useCallback: <T>(callback: T) => callback,
  useRef: <T>(initial: T) => ({ current: initial }),
}));

vi.mock("react-native", () => ({ Alert: { alert: mocks.alert } }));

vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
}));

vi.mock("../../lib/i18n", () => ({ useMobileI18n: () => ({ t: (key: string) => key }) }));

vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));

vi.mock("../../state/threads", () => ({
  threadEnvironment: {
    archive: {},
    delete: {},
    pin: {},
    reorderPin: {},
    settle: {},
    snooze: {},
    unarchive: {},
    unpin: {},
    unsettle: {},
    unsnooze: {},
    updateMetadata: {},
  },
  environmentThreadShells: { threadShellsAtom: {} },
}));

vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: { get: () => [] } }));

vi.mock("./environment-thread-capabilities", () => ({
  environmentSupportsThreadCapability: () => true,
}));

vi.mock("../archive/useArchivedThreadSnapshots", () => ({
  refreshArchivedThreadsForEnvironment: vi.fn(),
}));

vi.mock("../../components/ConfirmDialogHost", () => ({ showConfirmDialog: vi.fn() }));

const { useThreadActionExecutor } = await import("./use-thread-action-executor");

const { useThreadListActions } = await import("./useThreadListActions");

const NOW = "2026-01-01T00:00:00.000Z";

const makeThreadShell = (
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell => ({
  environmentId: EnvironmentId.make("environment-1"),
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  ...overrides,
});

const session = (status: OrchestrationSession["status"]): OrchestrationSession => ({
  threadId: ThreadId.make("thread-1"),
  status,
  providerName: "Codex",
  runtimeMode: "full-access",
  activeTurnId: null,
  lastError: null,
  updatedAt: NOW,
});

/** A failed command carrying one refusal code and the server's own sentence. */
const failedCommand = (refusal: string, message: string) => ({
  _tag: "Failure" as const,
  cause: Cause.fail({ _tag: "OrchestrationCommandInvariantError", message, refusal }),
});

/** The description of the single alert a control raised. */
const alertDescription = () => {
  const [, description] = mocks.alert.mock.calls[0] ?? [];

  return description;
};

beforeEach(() => {
  mocks.alert.mockReset();
  mocks.command.mockReset();
});

describe("mobile thread actions", () => {
  it("settling a chat with work in flight names why, not the thread id", async () => {
    mocks.command.mockResolvedValue(
      failedCommand(
        "thread-is-busy",
        "thread thread-7f3a has an active session and cannot be settled",
      ),
    );

    const executeAction = useThreadActionExecutor();
    const settled = await executeAction("settle", makeThreadShell());

    expect(settled).toBe(false);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(alertDescription()).toBe(
      "This chat has work in flight. Wait for it to finish, or respond to it.",
    );
    expect(alertDescription()).not.toContain("thread-7f3a");
  });

  it("pinning a chat whose state moved on names why, not the thread id", async () => {
    mocks.command.mockResolvedValue(
      failedCommand(
        "thread-state-invalid",
        "thread thread-7f3a is not pinned and cannot be reordered",
      ),
    );

    const { pinThread } = useThreadListActions();
    const pinned = await pinThread(makeThreadShell());

    expect(pinned).toBe(false);
    expect(mocks.alert).toHaveBeenCalledTimes(1);
    expect(alertDescription()).toBe(
      "That action does not fit this chat's current state. Refresh and try again.",
    );
    expect(alertDescription()).not.toContain("thread-7f3a");
  });

  it("says its own sentence for a refusal code it does not know", async () => {
    // A newer server's code: the refusal vocabulary is the server's, so a code
    // this build cannot name is not news it can word. The surface says its own
    // line rather than printing the server's sentence. TASK-384 AC4 supersedes
    // TASK-287's unknown-code fallback here.
    mocks.command.mockResolvedValue(
      failedCommand("thread-state-unheard-of", "Thread 'thread-7f3a' history already matches."),
    );

    const { pinThread } = useThreadListActions();
    await pinThread(makeThreadShell());

    expect(alertDescription()).toBe("The chat could not be pinned.");
    expect(alertDescription()).not.toContain("thread-7f3a");
  });

  it("still reports the surface's own wording when the server sent no sentence", async () => {
    mocks.command.mockResolvedValue({
      _tag: "Failure" as const,
      cause: Cause.fail(new Error(" ")),
    });

    const executeAction = useThreadActionExecutor();
    await executeAction("settle", makeThreadShell());

    expect(alertDescription()).toBe("The chat could not be settled.");
  });

  it("settles a chat with no live work", async () => {
    mocks.command.mockResolvedValue({ _tag: "Success" as const, value: undefined });

    const executeAction = useThreadActionExecutor();
    const settled = await executeAction("settle", makeThreadShell({ session: session("stopped") }));

    expect(settled).toBe(true);
    expect(mocks.alert).not.toHaveBeenCalled();
  });
});
