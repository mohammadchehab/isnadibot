import type { BotSkill, SkillId } from "@isnadi/contracts";
import type { BotSkillEntry } from "@isnadi/client-runtime/skills";

/** One switch in a bot's skills sheet: what the row says, and whether the bot loads it. */
export type BotSkillRow = {
  readonly skillId: SkillId;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
};

/**
 * The bot's own skills as the sheet draws them. A skill the registry does not list yet keeps
 * its row — the id stands in for the name and the description is left empty — so a registry
 * that has not loaded shortens nothing and every switch the bot stores stays reachable.
 */
export function botSkillRows(entries: readonly BotSkillEntry[]): readonly BotSkillRow[] {
  return entries.map((entry) => ({
    skillId: entry.skillId,
    name: entry.skill?.name ?? entry.skillId,
    description: entry.skill?.description ?? "",
    enabled: entry.enabled,
  }));
}

/** How many of the bot's skills are on; the sheet's subtitle counts these, not the rows. */
export function botSkillsOnCount(rows: readonly BotSkillRow[]): number {
  return rows.filter((row) => row.enabled).length;
}

/** The bot's set with one skill switched; a skill the bot does not have leaves the set as it was. */
export function toggleBotSkill(
  skills: readonly BotSkill[],
  skillId: SkillId,
  enabled: boolean,
): readonly BotSkill[] {
  return skills.map((skill) => (skill.skillId === skillId ? { ...skill, enabled } : skill));
}
