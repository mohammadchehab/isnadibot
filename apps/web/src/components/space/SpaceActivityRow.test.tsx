import { IsnadiDelegationRecord, ThreadId, TurnId } from "@isnadi/contracts";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    locale: "en-GB",
    formatNumber: (value: number) => String(value),
    plural: (count: number, forms: { one: string; other: string }) =>
      (count === 1 ? forms.one : forms.other).replace("{count}", String(count)),
    t: (message: string, values?: Record<string, string>) =>
      Object.entries(values ?? {}).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, value),
        message,
      ),
  }),
}));

import type { Bot } from "../roster/types";
import { SpaceActivityRow, SpaceChatActivityRow } from "./SpaceActivityRow";

const NOW = Date.parse("2026-08-31T00:10:00.000Z");

const decodeDelegationRecord = Schema.decodeUnknownSync(IsnadiDelegationRecord);

const child: Bot = {
  id: "bot-child",
  name: "Scout",
  title: "Recruiter",
  label: null,
  description: null,
  disabledMcpServerIds: [],
  avatar: { kind: "dither", seed: "scout" },
  engine: null,
  sandbox: "local",
  runtimeMode: "approval-required",
  voiceEnabled: false,
  groupId: null,
  pinned: false,
  archivedAt: null,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const CHILD_THREAD = ThreadId.make("thread-child");

const CHILD_TURN = TurnId.make("turn-child");

const RUN = { childThreadId: CHILD_THREAD, childTurnId: CHILD_TURN };

function delegation(phase: IsnadiDelegationRecord["phase"], task = "Post the opening.") {
  return decodeDelegationRecord({
    delegationId: "delegation-1",
    parentDelegationId: null,
    parentBotId: "bot-parent",
    childBotId: "bot-child",
    parentThreadId: "thread-parent",
    parentTurnId: "turn-parent",
    ancestorBotIds: ["bot-parent"],
    depth: 1,
    task,
    expectedResult: "The posting is live.",
    deadline: null,
    access: {
      allowedToolIds: ["Read"],
      memoryScopes: ["project"],
      sandbox: "local",
      runtimeMode: "approval-required",
      hasUserComputer: false,
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
      approvalCeiling: "none",
    },
    billedBotId: "bot-child",
    phase,
    keep: false,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:05:00.000Z",
  });
}

const renderDelegation = (record: IsnadiDelegationRecord, onReview: (() => void) | null = null) =>
  renderToStaticMarkup(
    <SpaceActivityRow delegation={record} bot={child} now={NOW} onReview={onReview} />,
  );

describe("SpaceActivityRow", () => {
  it("says what is waiting on the reader, not the raw state, and offers Review", () => {
    const html = renderDelegation(
      delegation({
        _tag: "Blocked",
        ...RUN,
        startedAt: "2026-08-31T00:01:00.000Z",
        reason: "careers.example.com signed Scout out.",
      }),
      () => undefined,
    );

    expect(html).toContain("Scout");
    expect(html).toContain("careers.example.com signed Scout out.");
    expect(html).toContain("Waiting on you");
    expect(html).not.toContain(">blocked<");
    expect(html).toContain("Review");
  });

  it("says what happened when the work finished", () => {
    const html = renderDelegation(
      delegation({
        _tag: "Completed",
        ...RUN,
        startedAt: "2026-08-31T00:01:00.000Z",
        completedAt: "2026-08-31T00:05:00.000Z",
        acknowledgedAt: null,
        result: {
          summary: "Posted the opening. Three candidates applied.",
          childThreadId: CHILD_THREAD,
          childTurnId: CHILD_TURN,
        },
      }),
    );

    expect(html).toContain("Posted the opening. Three candidates applied.");
    expect(html).toContain("completed");
    expect(html).not.toContain("Post the opening.");
  });

  it("falls back to the ask while there is no outcome, and offers no Review", () => {
    const html = renderDelegation(delegation({ _tag: "Queued" }, "Post the opening."));

    expect(html).toContain("Post the opening.");
    expect(html).toContain("queued");
    expect(html).not.toContain("Review");
  });
});

describe("SpaceChatActivityRow", () => {
  const renderChat = (decision: boolean) =>
    renderToStaticMarkup(
      <SpaceChatActivityRow
        title="Quarterly hiring plan"
        bot={child}
        updatedAt="2026-08-31T00:05:00.000Z"
        now={NOW}
        decision={decision}
        onReview={decision ? () => undefined : null}
      />,
    );

  it("carries only the time when nothing is waiting", () => {
    const html = renderChat(false);

    expect(html).toContain("Quarterly hiring plan");
    expect(html).toContain("5m ago");
    expect(html).not.toContain("Waiting on you");
    expect(html).not.toContain("Review");
  });

  it("is a needs-you row when a decision waits on the reader", () => {
    const html = renderChat(true);

    expect(html).toContain("Waiting on you");
    expect(html).toContain("5m ago");
    expect(html).toContain("Review");
    expect(html).toContain("bg-warning-surface");
  });
});
