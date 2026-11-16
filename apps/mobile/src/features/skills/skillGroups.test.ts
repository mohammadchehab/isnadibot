import { SkillId } from "@isnadi/contracts";
import type { RegistrySkill } from "@isnadi/client-runtime/skills";
import { describe, expect, it } from "vite-plus/test";

import { skillGroups } from "./skillGroups";

function skill(
  name: string,
  source: RegistrySkill["source"],
  approval: RegistrySkill["approval"] = "not-needed",
): RegistrySkill {
  return {
    id: SkillId.make(name),
    name,
    description: `${name} description`,
    source,
    sizeTokens: 1_800,
    fileCount: 1,
    contentHash: "a1b2c3d",
    approval,
    requires: [],
    usedBy: [],
  };
}

function names(skills: readonly RegistrySkill[]): readonly string[] {
  return skills.map((entry) => entry.name);
}

describe("mobile skill groups", () => {
  it("draws community, this space, built in and provider in that order", () => {
    const groups = skillGroups([
      skill("codex-review", "provider"),
      skill("candidate-search", "built-in"),
      skill("job-posting", "space"),
      skill("interview-kit", "community", "approved"),
    ]);

    expect(groups.map((group) => group.key)).toEqual([
      "community",
      "space",
      "built-in",
      "provider",
    ]);
  });

  it("puts a skill added to all spaces in This space", () => {
    const groups = skillGroups([skill("tone-of-voice", "yours")]);

    expect(groups.map((group) => group.key)).toEqual(["space"]);
    expect(names(groups[0]?.skills ?? [])).toEqual(["tone-of-voice"]);
  });

  it("keeps the registry's row order inside a group and drops the empty ones", () => {
    const groups = skillGroups([
      skill("site-sign-in", "built-in"),
      skill("candidate-search", "built-in"),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["built-in"]);
    expect(names(groups[0]?.skills ?? [])).toEqual(["site-sign-in", "candidate-search"]);
  });

  it("marks a group that holds a skill waiting for approval", () => {
    const waiting = skillGroups([
      skill("salary-benchmark", "community", "needs-approval"),
      skill("interview-kit", "community", "approved"),
    ]);

    const settled = skillGroups([skill("interview-kit", "community", "approved")]);

    expect(waiting[0]?.needsApproval).toBe(true);
    expect(settled[0]?.needsApproval).toBe(false);
  });
});
