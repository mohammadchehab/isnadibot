import { SkillId } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  skillAddFileSizeLabel,
  skillAddNameFromUrl,
  skillAddUrlIsGitHub,
  skillAddZipRefusal,
  skillProviderGroups,
} from "./skillAdd.ts";
import type { RegistrySkill } from "./types.ts";

function skill(name: string, source: RegistrySkill["source"], driver?: string): RegistrySkill {
  return {
    id: SkillId.make(`${source}:all:${name}`),
    name,
    description: `${name} does a thing.`,
    source,
    ...(driver === undefined ? {} : { providerDriver: driver }),
    sizeTokens: 1_200,
    fileCount: 1,
    contentHash: "abc1234",
    approval: "not-needed",
    requires: [],
    usedBy: [],
  };
}

describe("the add-skill rules", () => {
  it("takes a github folder link and nothing else", () => {
    expect(skillAddUrlIsGitHub("https://github.com/acme/skills/tree/main/one")).toBe(true);
    expect(skillAddUrlIsGitHub("https://gitlab.com/acme/skills")).toBe(false);
    expect(skillAddUrlIsGitHub("http://github.com/acme/skills")).toBe(false);
    expect(skillAddUrlIsGitHub("not a link")).toBe(false);
  });

  it("names the folder a link points at", () => {
    expect(skillAddNameFromUrl("https://github.com/acme/skills/tree/main/candidate-search")).toBe(
      "candidate-search",
    );
    expect(skillAddNameFromUrl("https://github.com/acme/skills/")).toBe("skills");
    expect(skillAddNameFromUrl("https://github.com/acme/skills?tab=readme")).toBe("skills");
    expect(skillAddNameFromUrl("https://github.com")).toBeUndefined();
  });

  it("refuses an archive over the limit before it looks at the bytes", () => {
    expect(skillAddZipRefusal({ sizeBytes: 7.4 * 1024 * 1024, leadingBytes: [0x50, 0x4b] })).toBe(
      "zip-too-big",
    );
    expect(
      skillAddZipRefusal({ sizeBytes: 4 * 1024 * 1024, leadingBytes: [0x50, 0x4b] }),
    ).toBeNull();
  });

  it("refuses a file that is not a zip at all", () => {
    expect(skillAddZipRefusal({ sizeBytes: 1_000, leadingBytes: [0x89, 0x50] })).toBe(
      "bad-archive",
    );
  });

  it("says how far over the limit an archive is", () => {
    expect(skillAddFileSizeLabel(7.4 * 1024 * 1024)).toBe("7.4 MB");
  });

  it("groups provider skills by the driver that reports them", () => {
    const groups = skillProviderGroups([
      skill("candidate-search", "provider", "claude"),
      skill("interview-kit", "provider", "claude"),
      skill("pipeline-update", "provider", "codex"),
      skill("mine", "space"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["Claude", "Codex"]);
    expect(groups[0]?.skills.map((entry) => entry.name)).toEqual([
      "candidate-search",
      "interview-kit",
    ]);
  });
});
