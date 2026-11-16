import type { RegistrySkill, SkillSource } from "@isnadi/client-runtime/skills";

/**
 * The order the Skills screen draws its groups in: what other people shared, what this space
 * and the user keep, what ships with the app, and what a provider contributes.
 */
export const SKILL_GROUP_ORDER = ["community", "space", "built-in", "provider"] as const;

export type SkillGroupKey = (typeof SKILL_GROUP_ORDER)[number];

/** One headed block of rows. */
export type SkillGroup = {
  readonly key: SkillGroupKey;
  /** The group's rows, in the registry's own order. */
  readonly skills: readonly RegistrySkill[];
  /** Whether the header carries the "· needs your approval" suffix. */
  readonly needsApproval: boolean;
};

/**
 * The group a source lands in. A skill the user added to all spaces is their own copy, so it
 * sits with this space's skills instead of a group of its own — the frame draws `tone-of-voice`
 * under "This space" with a "Yours" badge.
 */
function groupKeyForSource(source: SkillSource): SkillGroupKey {
  switch (source) {
    case "community":
      return "community";
    case "space":
    case "yours":
      return "space";
    case "built-in":
      return "built-in";
    case "provider":
      return "provider";
  }
}

/**
 * The registry as the screen draws it: the four groups in `SKILL_GROUP_ORDER`, each keeping the
 * registry's row order, with empty groups dropped so no header sits over nothing.
 */
export function skillGroups(skills: readonly RegistrySkill[]): readonly SkillGroup[] {
  return SKILL_GROUP_ORDER.flatMap((key) => {
    const members = skills.filter((skill) => groupKeyForSource(skill.source) === key);

    if (members.length === 0) return [];

    return [
      {
        key,
        skills: members,
        needsApproval: members.some((skill) => skill.approval === "needs-approval"),
      },
    ];
  });
}
