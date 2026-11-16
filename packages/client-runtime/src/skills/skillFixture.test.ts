import { describe, expect, it } from "vite-plus/test";

import { SKILL_FIXTURE_SCENARIOS, createSkillRegistryFixture } from "./skillFixture.ts";
import { isSkillWinner, skillAttention, skillWinnersByName } from "./skillPresentation.ts";
import type { RegistrySkill } from "./types.ts";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

function fullRegistry(): readonly RegistrySkill[] {
  return createSkillRegistryFixture({ dev: true, nowMs: NOW }).getSnapshot().skills;
}

function named(name: string): RegistrySkill {
  const found = fullRegistry().find((skill) => skill.name === name);

  if (found === undefined) throw new Error(`no fixture skill named ${name}`);

  return found;
}

describe("the dev fixture", () => {
  it("is the empty source when dev is off, so a shipped build renders nothing", () => {
    const snapshot = createSkillRegistryFixture({ dev: false }).getSnapshot();

    expect(snapshot).toEqual({ state: "unavailable", skills: [], unavailableConnectors: [] });
  });

  it("supplies a registry per scenario", () => {
    const states = SKILL_FIXTURE_SCENARIOS.map(
      (scenario) => createSkillRegistryFixture({ dev: true, scenario }).getSnapshot().state,
    );

    expect(states).toEqual(["ready", "ready", "loading", "error"]);
  });

  it("shows every source and marks which copy of a shared name wins", () => {
    const skills = fullRegistry();
    const winners = skillWinnersByName(skills);

    expect(new Set(skills.map((skill) => skill.source))).toEqual(
      new Set(["built-in", "space", "yours", "community", "provider"]),
    );

    const copies = skills.filter((skill) => skill.name === "job-posting");
    const winner = copies.find((copy) => isSkillWinner(copy, winners));

    expect(copies).toHaveLength(2);
    expect(winner?.source).toBe("space");
  });

  it("covers the three states a row can be in, and a row no bot uses", () => {
    const snapshot = createSkillRegistryFixture({ dev: true, nowMs: NOW }).getSnapshot();

    expect(skillAttention(named("salary-benchmark"), snapshot.unavailableConnectors)).toEqual({
      kind: "needs-approval",
    });
    expect(named("salary-benchmark").approvalChange).toBeUndefined();

    expect(skillAttention(named("comp-bands"), snapshot.unavailableConnectors)).toEqual({
      kind: "changed-since-approved",
    });

    expect(skillAttention(named("browser-scrape"), snapshot.unavailableConnectors)).toEqual({
      kind: "needs-connector",
      connector: "browser",
    });

    expect(named("video-cut-list").usedBy).toEqual([]);
  });

  it("gives one skill every bot, so the Used by column can read All spaces", () => {
    expect(named("tone-of-voice").usedBy).toHaveLength(4);
  });

  it("places its timestamps relative to the clock it is given", () => {
    const first = named("candidate-search");

    const later = createSkillRegistryFixture({ dev: true, nowMs: NOW + 60_000 })
      .getSnapshot()
      .skills.find((skill) => skill.id === first.id);

    expect(first.lastLoadedAt).toBeDefined();
    expect(Date.parse(later?.lastLoadedAt ?? "")).toBe(
      Date.parse(first.lastLoadedAt ?? "") + 60_000,
    );
  });
});

describe("the dev fixture's writes", () => {
  function writable() {
    const source = createSkillRegistryFixture({ dev: true, nowMs: NOW });
    const actions = source.actions;

    if (actions === undefined) throw new Error("the dev fixture is not writable");

    return { source, actions };
  }

  it("adds a provider skill to the space and redraws its subscribers", () => {
    const { source, actions } = writable();
    let redraws = 0;

    source.subscribe(() => {
      redraws += 1;
    });

    const provider = source
      .getSnapshot()
      .skills.find((skill) => skill.source === "provider" && skill.providerDriver !== undefined);

    if (provider === undefined) throw new Error("the fixture lists no provider skill");

    expect(
      actions.addSkill({ source: "provider", scope: "this-space", input: provider.id }),
    ).toEqual({ kind: "added", skillId: expect.anything() });
    expect(redraws).toBe(1);
    expect(
      source.getSnapshot().skills.filter((skill) => skill.name === provider.name),
    ).toHaveLength(2);
  });

  it("refuses a GitHub folder it cannot fetch, with the refusal the dialog draws", () => {
    const { actions } = writable();

    expect(
      actions.addSkill({
        source: "github",
        scope: "this-space",
        input: "https://github.com/acme/skills/tree/main/no-such-folder",
      }),
    ).toEqual({ kind: "refused", refusal: "link-not-found" });
  });

  it("hands a Community skill back for approval, and approving lets a bot use it", () => {
    const { source, actions } = writable();

    const outcome = actions.addSkill({
      source: "github",
      scope: "all-spaces",
      input: "https://github.com/acme/recruiting-skills/tree/main/salary-benchmark",
    });

    if (outcome.kind !== "needs-approval") throw new Error(`unexpected outcome ${outcome.kind}`);

    const approvalOf = () =>
      source.getSnapshot().skills.find((skill) => skill.id === outcome.skillId)?.approval;

    expect(approvalOf()).toBe("needs-approval");

    actions.approveSkill(outcome.skillId);

    expect(approvalOf()).toBe("approved");
  });

  it("removes a skill", () => {
    const { source, actions } = writable();
    const victim = source.getSnapshot().skills.find((skill) => skill.name === "video-cut-list");

    if (victim === undefined) throw new Error("the fixture lists no video-cut-list");

    actions.removeSkill(victim.id);

    expect(source.getSnapshot().skills.some((skill) => skill.id === victim.id)).toBe(false);
  });
});
