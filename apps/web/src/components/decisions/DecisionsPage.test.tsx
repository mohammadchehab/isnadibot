import type { Decision } from "@isnadi/client-runtime/decisions";
import { EnvironmentId, ThreadId } from "@isnadi/contracts";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Bot, Group } from "../roster/types";

const state = vi.hoisted(() => ({
  decisions: [] as Decision[],
  bootstrapped: true,
  bots: [
    {
      id: "bot-ada",
      name: "Ada",
      title: "Ada",
      label: null,
      description: null,
      disabledMcpServerIds: [],
      avatar: { kind: "blob", shape: "circle", color: "#2E8EFF" },
      engine: null,
      sandbox: "local",
      runtimeMode: "full-access",
      voiceEnabled: false,
      groupId: null,
      pinned: false,
      archivedAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ] as Bot[],
  groups: [
    {
      id: "group-design",
      name: "Design crew",
      bossBotId: null,
      members: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ] as Group[],
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (message: string) => message }),
}));

vi.mock("../../state/entities", () => ({
  useDecisions: () => state.decisions,
  useAllEnvironmentShellsBootstrapped: () => state.bootstrapped,
}));

vi.mock("../../state/environments", () => ({ usePrimaryEnvironmentId: () => null }));

vi.mock("../chat/useOpenChat", () => ({ useOpenChat: () => vi.fn() }));

vi.mock("../roster/rosterStore", () => ({
  useRosterStore: <T,>(selector: (store: { bots: Bot[]; groups: Group[] }) => T) =>
    selector({ bots: state.bots, groups: state.groups }),
}));

vi.mock("../roster/BotAvatarView", () => ({
  BotAvatarView: () => <span data-testid="avatar" />,
}));

vi.mock("../ui/sidebar", () => ({
  SidebarInset: ({ tone: _tone, ...props }: ComponentProps<"div"> & { tone?: string }) => (
    <div {...props} />
  ),
}));

import { DecisionsPage } from "./DecisionsPage";

function decision(id: string, kind: Decision["kind"], owner: Partial<Decision> = {}): Decision {
  return {
    environmentId: EnvironmentId.make("env-1"),
    threadId: ThreadId.make(id),
    targetThreadId: ThreadId.make(id),
    botId: "bot-ada",
    groupId: null,
    title: `Chat ${id}`,
    kind,
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...owner,
  };
}

describe("DecisionsPage", () => {
  beforeEach(() => {
    state.decisions = [];
    state.bootstrapped = true;
  });

  it("draws one row per decision, a bot's with its avatar and a space's with a tile", () => {
    state.decisions = [
      decision("t-1", "approval"),
      decision("t-2", "question", { botId: null, groupId: "group-design" }),
    ];

    const markup = renderToStaticMarkup(<DecisionsPage />);

    expect(markup).toContain("Decisions");
    expect(markup).toContain('aria-label="Approval needed: Ada · Chat t-1"');
    expect(markup).toContain('aria-label="Question: Design crew · Chat t-2"');
    expect(markup.match(/data-testid="avatar"/g)).toHaveLength(1);
    expect(markup).toContain("lucide-users");
  });

  it("holds the skeleton until every environment shell has answered", () => {
    state.bootstrapped = false;

    const markup = renderToStaticMarkup(<DecisionsPage />);

    expect(markup).toContain('data-testid="decisions-loading"');
    expect(markup).not.toContain('data-testid="decisions-empty"');
  });

  it("says nothing is waiting once the shells are up and the queue is empty", () => {
    const markup = renderToStaticMarkup(<DecisionsPage />);

    expect(markup).toContain('data-testid="decisions-empty"');
    expect(markup).toContain("Nothing waiting on you");
    expect(markup).toContain("When a bot needs an approval or an answer, it shows up here.");
    expect(markup).not.toContain('data-testid="decisions-loading"');
  });
});
