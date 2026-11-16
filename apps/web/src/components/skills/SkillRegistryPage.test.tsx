import { BotId, ProjectId, SkillId } from "@isnadi/contracts";
import type { RegistrySkill, SkillRegistrySnapshot } from "@isnadi/client-runtime/skills";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SkillRegistryPage } from "./SkillRegistryPage.tsx";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const MINUTE = 60_000;

const SPACE = ProjectId.make("space-recruiting");

const scout = BotId.make("bot-scout");

/** The registry the screen reads; each test replaces it before rendering. */
type RegistryMocks = { snapshot: SkillRegistrySnapshot };

const mocks = vi.hoisted(
  (): RegistryMocks => ({
    snapshot: { state: "unavailable", skills: [], unavailableConnectors: [] },
  }),
);

vi.mock("@isnadi/client-runtime/skills", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@isnadi/client-runtime/skills")>();

  return { ...actual, useSkillRegistry: () => mocks.snapshot };
});

vi.mock("../roster/BotAvatarView", () => ({ BotAvatarView: () => null }));

vi.mock("../roster/rosterStore", () => ({ useRosterStore: () => [] }));

vi.mock("../settings/settingsLayout", () => ({ useRelativeTimeTick: () => NOW }));

function skill(overrides: Partial<RegistrySkill> & { readonly name: string }): RegistrySkill {
  return {
    id: SkillId.make(`built-in:all:${overrides.name}`),
    description: "",
    source: "built-in",
    sizeTokens: 1_800,
    fileCount: 1,
    contentHash: "abc1234",
    approval: "not-needed",
    requires: [],
    usedBy: [scout],
    lastLoadedAt: new Date(NOW - 4 * MINUTE).toISOString(),
    ...overrides,
  };
}

function snapshotOf(overrides: Partial<SkillRegistrySnapshot>): SkillRegistrySnapshot {
  return { state: "ready", skills: [], unavailableConnectors: [], ...overrides };
}

function render(): string {
  return renderToStaticMarkup(<SkillRegistryPage />);
}

beforeEach(() => {
  mocks.snapshot = snapshotOf({});
});

describe("the skill registry screen", () => {
  it("renders nothing on a platform with no registry source", () => {
    mocks.snapshot = { state: "unavailable", skills: [], unavailableConnectors: [] };

    expect(render()).toBe("");
  });

  it("draws a row with its source, size and last load", () => {
    mocks.snapshot = snapshotOf({ skills: [skill({ name: "candidate-search" })] });

    const markup = render();

    expect(markup).toContain("candidate-search");
    expect(markup).toContain("Built in");
    expect(markup).toContain("1.8k");
    expect(markup).toContain("4m ago");
    expect(markup).toContain("Skill registry");
  });

  it("carries the state word and the action on a row that needs the user", () => {
    mocks.snapshot = snapshotOf({
      skills: [
        skill({
          id: SkillId.make("community:all:salary-benchmark"),
          name: "salary-benchmark",
          source: "community",
          approval: "needs-approval",
        }),
      ],
    });

    const markup = render();

    expect(markup).toContain("Needs approval");
    expect(markup).toContain("Approve");
    expect(markup).toContain("A bot cannot use it until you approve it.");
  });

  it("says so when the registry did not load", () => {
    mocks.snapshot = { state: "error", skills: [], unavailableConnectors: [] };

    expect(render()).toContain("The skill registry did not load.");
  });

  it("draws no rows while it is loading", () => {
    mocks.snapshot = snapshotOf({
      state: "loading",
      skills: [skill({ name: "candidate-search" })],
    });

    expect(render()).not.toContain("candidate-search");
  });

  it("keeps this space's rows and the ones every space shares", () => {
    mocks.snapshot = snapshotOf({
      skills: [
        skill({
          id: SkillId.make("space:recruiting:mine"),
          name: "mine",
          source: "space",
          projectId: SPACE,
        }),
        skill({ name: "shared" }),
      ],
    });

    const markup = render();

    expect(markup).toContain("mine");
    expect(markup).toContain("shared");
  });
});
