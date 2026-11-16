import { createSkillRegistryFixture, type BotSkillEntry } from "@isnadi/client-runtime/skills";
import { describe, expect, it } from "vite-plus/test";

import { botSkillRows, botSkillsOnCount, toggleBotSkill } from "./botSkillsRows";

const registry = createSkillRegistryFixture({ dev: true });

const [first, second] = registry.getSnapshot().skills;

function entry(
  skillId: BotSkillEntry["skillId"],
  enabled: boolean,
  skill?: BotSkillEntry["skill"],
) {
  return { skillId, enabled, skill } satisfies BotSkillEntry;
}

describe("a bot's skill rows", () => {
  it("names a row from the registry and carries its description", () => {
    const rows = botSkillRows([entry(first!.id, true, first)]);

    expect(rows[0]?.name).toBe(first!.name);
    expect(rows[0]?.description).toBe(first!.description);
  });

  it("keeps a skill the registry does not list, named by its id", () => {
    const rows = botSkillRows([entry(second!.id, false, undefined)]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(second!.id);
    expect(rows[0]?.description).toBe("");
  });

  it("counts only the skills that are on", () => {
    const rows = botSkillRows([entry(first!.id, true, first), entry(second!.id, false, second)]);

    expect(botSkillsOnCount(rows)).toBe(1);
  });

  it("switches one skill and leaves the rest of the set alone", () => {
    const skills = [
      { skillId: first!.id, enabled: true },
      { skillId: second!.id, enabled: true },
    ];

    expect(toggleBotSkill(skills, second!.id, false)).toEqual([
      { skillId: first!.id, enabled: true },
      { skillId: second!.id, enabled: false },
    ]);
  });
});
