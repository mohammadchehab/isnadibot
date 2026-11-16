import { BotId, ProjectId, SkillId } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  filterRegistrySkills,
  isSkillWinner,
  skillAttention,
  skillAttentionActionLabel,
  skillAttentionDetail,
  skillAttentionLabel,
  skillConnectorName,
  skillLastLoadedLabel,
  skillOriginLabel,
  skillSizeLabel,
  skillSourceLabel,
  skillUsedByPresentation,
  skillWinnersByName,
} from "./skillPresentation.ts";
import type { RegistrySkill } from "./types.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

const SPACE = ProjectId.make("space-recruiting");

const OTHER_SPACE = ProjectId.make("space-sales");

const scout = BotId.make("bot-scout");

const tailor = BotId.make("bot-tailor");

const tracker = BotId.make("bot-tracker");

const coach = BotId.make("bot-coach");

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const DAY = 24 * HOUR;

function skill(overrides: Partial<RegistrySkill> & { readonly name: string }): RegistrySkill {
  return {
    id: SkillId.make(`built-in:all:${overrides.name}`),
    description: "",
    source: "built-in",
    sizeTokens: 1_000,
    fileCount: 1,
    contentHash: "abc1234",
    approval: "not-needed",
    requires: [],
    usedBy: [],
    ...overrides,
  };
}

describe("the copy of a shared name the index uses", () => {
  it("ranks a space copy above the user's own, built-in, and provider copies", () => {
    const copies = [
      skill({
        id: SkillId.make("provider:all:job-posting"),
        name: "job-posting",
        source: "provider",
      }),
      skill({ id: SkillId.make("built-in:all:job-posting"), name: "job-posting" }),
      skill({ id: SkillId.make("yours:all:job-posting"), name: "job-posting", source: "yours" }),
      skill({
        id: SkillId.make("space:recruiting:job-posting"),
        name: "job-posting",
        source: "space",
        projectId: SPACE,
      }),
    ];

    const winners = skillWinnersByName(copies);

    expect(winners.get("job-posting")?.id).toBe(SkillId.make("space:recruiting:job-posting"));
    expect(copies.map((copy) => isSkillWinner(copy, winners))).toEqual([false, false, false, true]);
  });

  it("ranks a community copy in a space with the space copies and one in the user's folder with Yours", () => {
    const inSpace = skill({ name: "tone", source: "community", projectId: SPACE });

    const inFolder = skill({
      id: SkillId.make("community:all:tone"),
      name: "tone",
      source: "community",
    });

    const builtIn = skill({ id: SkillId.make("built-in:all:tone"), name: "tone" });

    expect(isSkillWinner(inSpace, skillWinnersByName([builtIn, inFolder, inSpace]))).toBe(true);
    expect(isSkillWinner(inFolder, skillWinnersByName([builtIn, inFolder]))).toBe(true);
  });

  it("marks every name that appears once", () => {
    const winners = skillWinnersByName([skill({ name: "one" }), skill({ name: "two" })]);

    expect([...winners.keys()].sort()).toEqual(["one", "two"]);
  });
});

describe("the registry filters", () => {
  const mine = skill({ name: "mine", source: "space", projectId: SPACE });
  const theirs = skill({ name: "theirs", source: "space", projectId: OTHER_SPACE });
  const shared = skill({ name: "shared" });
  const unused = skill({ name: "unused" });
  const all = [mine, theirs, shared, unused];

  it("keeps this space's skills and the ones that belong to every space", () => {
    expect(filterRegistrySkills(all, "this-space", SPACE).map((entry) => entry.name)).toEqual([
      "mine",
      "shared",
      "unused",
    ]);
  });

  it("keeps everything when the caller holds no project, which is every space today", () => {
    expect(filterRegistrySkills(all, "this-space", undefined)).toHaveLength(all.length);
  });

  it("keeps every row under All skills", () => {
    expect(filterRegistrySkills(all, "all", SPACE)).toHaveLength(all.length);
  });

  it("keeps only the rows no bot uses under Unused", () => {
    const used = skill({ name: "used", usedBy: [scout] });

    expect(
      filterRegistrySkills([used, unused], "unused", SPACE).map((entry) => entry.name),
    ).toEqual(["unused"]);
  });
});

describe("the Last loaded column", () => {
  it("reads Not indexed for a skill no bot can see, whatever its timestamps say", () => {
    const hidden = skill({ name: "hidden", lastLoadedAt: new Date(NOW).toISOString() });

    expect(skillLastLoadedLabel(hidden, NOW)).toBe("Not indexed");
  });

  it("reads Never for an indexed skill no bot has loaded", () => {
    expect(skillLastLoadedLabel(skill({ name: "idle", usedBy: [scout] }), NOW)).toBe("Never");
  });

  it("reads Never for a timestamp it cannot parse", () => {
    const broken = skill({ name: "broken", usedBy: [scout], lastLoadedAt: "not a date" });

    expect(skillLastLoadedLabel(broken, NOW)).toBe("Never");
  });

  it("reads Just now, then the app's span wording", () => {
    const loadedAgo = (elapsed: number) =>
      skillLastLoadedLabel(
        skill({
          name: "loaded",
          usedBy: [scout],
          lastLoadedAt: new Date(NOW - elapsed).toISOString(),
        }),
        NOW,
      );

    expect(loadedAgo(30_000)).toBe("Just now");
    expect(loadedAgo(4 * MINUTE)).toBe("4m ago");
    expect(loadedAgo(1 * HOUR)).toBe("1h ago");
    expect(loadedAgo(3 * DAY)).toBe("3d ago");
  });

  it("names the day before this one Yesterday", () => {
    const yesterday = skill({
      name: "yesterday",
      usedBy: [scout],
      lastLoadedAt: new Date(NOW - DAY).toISOString(),
    });

    expect(skillLastLoadedLabel(yesterday, NOW)).toBe("Yesterday");
  });
});

describe("the Used by column", () => {
  const names = new Map([
    [scout, "Scout"],
    [tailor, "Tailor"],
    [tracker, "Tracker"],
    [coach, "Coach"],
  ]);

  it("reads No role when no bot uses the skill", () => {
    expect(skillUsedByPresentation(skill({ name: "a" }), names)).toEqual({
      kind: "none",
      label: "No role",
    });
  });

  it("names a single bot", () => {
    expect(skillUsedByPresentation(skill({ name: "a", usedBy: [scout] }), names)).toEqual({
      kind: "text",
      label: "Scout",
    });
  });

  it("stacks up to three bots", () => {
    const presented = skillUsedByPresentation(skill({ name: "a", usedBy: [scout, tailor] }), names);

    expect(presented).toEqual({ kind: "stack", label: "Scout, Tailor", botIds: [scout, tailor] });
  });

  it("says All spaces for a skill of the user's own used by more than three bots", () => {
    const presented = skillUsedByPresentation(
      skill({ name: "a", source: "yours", usedBy: [scout, tailor, tracker, coach] }),
      names,
    );

    expect(presented).toEqual({ kind: "text", label: "All spaces" });
  });

  it("counts the bots when the skill belongs to one place", () => {
    const presented = skillUsedByPresentation(
      skill({ name: "a", usedBy: [scout, tailor, tracker, coach] }),
      names,
    );

    expect(presented).toEqual({ kind: "text", label: "4 bots" });
  });
});

describe("the Source column", () => {
  it("names each source", () => {
    expect(
      (["built-in", "space", "yours", "community", "provider"] as const).map((source) =>
        skillSourceLabel(source),
      ),
    ).toEqual(["Built in", "Space", "Yours", "Community", "Provider"]);
  });
});

describe("a row that needs the user", () => {
  const origin = { url: "https://github.com/acme/recruiting-skills", commit: "4f2a1c9" };

  it("asks for approval first, before it mentions a missing connector", () => {
    const unapproved = skill({
      name: "a",
      approval: "needs-approval",
      requires: ["browser"],
      origin,
    });

    expect(skillAttention(unapproved, ["browser"])).toEqual({ kind: "needs-approval" });
  });

  it("reports a change since approval when an approval came before it", () => {
    const changed = skill({
      name: "a",
      approval: "needs-approval",
      approvalChange: { approvedCommit: "4f2a1c9", addedFiles: 1, editedFiles: 2, removedFiles: 0 },
    });

    expect(skillAttention(changed, [])).toEqual({ kind: "changed-since-approved" });
  });

  it("reports a missing connector only for a skill that is otherwise usable", () => {
    const needsBrowser = skill({ name: "a", requires: ["browser"] });

    expect(skillAttention(needsBrowser, ["browser"])).toEqual({
      kind: "needs-connector",
      connector: "browser",
    });
    expect(skillAttention(needsBrowser, [])).toBeNull();
  });

  it("says nothing about a healthy row", () => {
    expect(skillAttention(skill({ name: "a" }), ["browser"])).toBeNull();
  });

  it("carries the state word, the warning line and the action for each state", () => {
    const unapproved = skill({ name: "a", approval: "needs-approval", origin });
    const unapprovedAttention = { kind: "needs-approval" } as const;

    expect(skillAttentionLabel(unapprovedAttention)).toBe("Needs approval");
    expect(skillAttentionDetail(unapproved, unapprovedAttention)).toBe(
      "Added from github.com/acme/recruiting-skills at 4f2a1c9 · a bot cannot use it until you approve it.",
    );
    expect(skillAttentionActionLabel(unapprovedAttention)).toBe("Approve");

    const anonymous = skill({ name: "b", approval: "needs-approval" });

    expect(skillAttentionDetail(anonymous, unapprovedAttention)).toBe(
      "A bot cannot use it until you approve it.",
    );
  });

  it("counts what changed since the approved commit", () => {
    const changed = skill({
      name: "a",
      approval: "needs-approval",
      origin: { url: "https://github.com/acme/recruiting-skills", commit: "9b31e07" },
      approvalChange: { approvedCommit: "4f2a1c9", addedFiles: 1, editedFiles: 2, removedFiles: 0 },
    });

    const attention = { kind: "changed-since-approved" } as const;

    expect(skillAttentionLabel(attention)).toBe("Changed since approved");
    expect(skillAttentionDetail(changed, attention)).toBe(
      "Changed at commit 9b31e07 since you approved 4f2a1c9 · 1 file added, 2 edited.",
    );
    expect(skillAttentionActionLabel(attention)).toBe("Review");
  });

  it("sends the user to the connector settings by name", () => {
    const needsBrowser = skill({ name: "a", requires: ["browser"] });
    const attention = { kind: "needs-connector", connector: "browser" } as const;

    expect(skillAttentionLabel(attention)).toBe("Needs Browser");
    expect(skillAttentionDetail(needsBrowser, attention)).toBe(
      "Connect the Browser connector in Settings › Connections. Until then a bot cannot run this skill.",
    );
    expect(skillAttentionActionLabel(attention)).toBe("Connect");
  });
});

describe("the small labels", () => {
  it("reads size as what loads, in thousands above a thousand", () => {
    expect([600, 900, 1_800, 2_000, 3_100].map(skillSizeLabel)).toEqual([
      "600",
      "900",
      "1.8k",
      "2k",
      "3.1k",
    ]);
  });

  it("names where a community skill came from without the scheme", () => {
    expect(
      skillOriginLabel({ url: "https://github.com/acme/recruiting-skills", commit: "4f2a1c9" }),
    ).toBe("github.com/acme/recruiting-skills at 4f2a1c9");
    expect(skillOriginLabel({ url: "http://example.com/s", commit: "abc" })).toBe(
      "example.com/s at abc",
    );
  });

  it("capitalises a connector id for a badge and a sentence", () => {
    expect(skillConnectorName("browser")).toBe("Browser");
    expect(skillConnectorName("firecrawl")).toBe("Firecrawl");
  });
});
