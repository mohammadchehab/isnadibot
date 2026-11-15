import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@isnadi/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import type { QueuedThreadFailure } from "../../state/thread-outbox-model";
import { ThreadListV2PendingRow } from "./thread-list-v2-pending-row";

/**
 * Pins the row's status slot: a failed send says "Not sent" in the danger
 * token while a merely queued one stays muted. Both used to share one grey
 * Text, so a failure read as ordinary queueing.
 */
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");

  return {
    Platform: {
      OS: "ios",
      select: (options: { readonly ios?: string; readonly default?: string }) =>
        options.ios ?? options.default,
    },
    Pressable: (props: { className?: string; children?: ReactNode }) =>
      h("button", { className: props.className }, props.children),
    View: (props: { className?: string; children?: ReactNode }) =>
      h("div", { className: props.className }, props.children),
  };
});

vi.mock("../../components/AppText", async () => {
  const { createElement: h } = await import("react");

  return {
    AppText: (props: { className?: string; numberOfLines?: number; children?: ReactNode }) =>
      h(
        "span",
        { className: props.className, "data-lines": props.numberOfLines ?? undefined },
        props.children,
      ),
  };
});

vi.mock("../../components/ControlPill", async () => {
  const { createElement: h } = await import("react");

  return { ControlPillMenu: (props: { children?: ReactNode }) => h("div", null, props.children) };
});

vi.mock("../../lib/i18n", async () => {
  const { createTranslator } = await import("@isnadi/client-runtime/i18n");
  const translator = createTranslator("en");

  return { useMobileI18n: () => ({ t: translator.translate }) };
});

vi.mock("../../lib/useThemeColor", () => ({ useThemeColor: () => "black" }));

vi.mock("../../state/use-queued-message-failure-actions", () => ({
  useQueuedMessageFailureActions: () => ({ retryQueuedMessage: vi.fn() }),
}));

vi.mock("./thread-list-v2-shelves", () => ({ ThreadListV2SectionDivider: () => null }));

const environmentId = EnvironmentId.make("environment-1");

function pendingTask(failure?: QueuedThreadFailure): PendingNewTask {
  const creation = {
    projectId: ProjectId.make("project-1"),
    workspaceMode: "worktree" as const,
    branch: null,
    worktreePath: null,
  };

  return {
    creation,
    message: {
      environmentId,
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("message-1"),
      commandId: CommandId.make("command-1"),
      text: "Ship the release notes",
      attachments: [],
      createdAt: "2026-11-15T12:00:00.000Z",
      creation,
      ...(failure === undefined ? {} : { failure }),
    },
    title: "Ship the release notes",
  };
}

function render(task: PendingNewTask) {
  return renderToStaticMarkup(
    <ThreadListV2PendingRow
      environmentLabel={null}
      onDeletePendingTask={() => {}}
      onSelectPendingTask={() => {}}
      pendingTask={task}
      project={null}
      showPendingDivider={false}
    />,
  );
}

const blocked: QueuedThreadFailure = {
  refusal: "unknown",
  action: "block",
  at: "2026-11-15T12:00:00.000Z",
};

describe("the queued new-task row status", () => {
  it("says Not sent in the danger token when the send failed", () => {
    const markup = render(pendingTask(blocked));

    expect(markup).toContain('<span class="text-danger-foreground">Not sent</span>');
    expect(markup).not.toContain(">Queued<");
  });

  it("keeps Queued muted when nothing has failed", () => {
    const markup = render(pendingTask());

    expect(markup).toContain('<span class="text-foreground-muted">Queued</span>');
    expect(markup).not.toContain("Not sent");
  });

  it("hands the failed text to the notice so two failures read differently", () => {
    expect(render(pendingTask(blocked))).toContain("Ship the release notes");
  });
});
