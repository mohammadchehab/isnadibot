import type { BotId } from "@isnadi/contracts";

import { createTranslator } from "../i18n/index.ts";
import type { RegistrySkill, SkillSource } from "./types.ts";

/** The translator slice skill labels need. Helpers default to English outside React. */
export type SkillTranslator = Pick<ReturnType<typeof createTranslator>, "t">;

const englishTranslator: SkillTranslator = createTranslator("en");

/** The segmented filter on the registry page: this space's skills, every skill, or none used yet. */
export const SKILL_REGISTRY_FILTERS = ["this-space", "all", "unused"] as const;

export type SkillRegistryFilter = (typeof SKILL_REGISTRY_FILTERS)[number];

/**
 * Precedence when a name is found in more than one place: space, yours, built in, provider.
 * A Community skill is a copy in a space or in the user's own folder, so it ranks by that
 * scope rather than by its source label.
 */
export function skillScopeRank(skill: RegistrySkill): number {
  switch (skill.source) {
    case "space":
      return 0;
    case "community":
      return skill.projectId === undefined ? 1 : 0;
    case "yours":
      return 1;
    case "built-in":
      return 2;
    case "provider":
      return 3;
  }
}

/** The id of the copy the index uses, per skill name. */
export function skillWinnersByName(
  skills: readonly RegistrySkill[],
): ReadonlyMap<string, RegistrySkill> {
  const winners = new Map<string, RegistrySkill>();

  for (const skill of skills) {
    const current = winners.get(skill.name);

    if (!current || skillScopeRank(skill) < skillScopeRank(current)) {
      winners.set(skill.name, skill);
    }
  }

  return winners;
}

/** Whether this row is the copy a bot loads when it asks for the name. */
export function isSkillWinner(
  skill: RegistrySkill,
  winners: ReadonlyMap<string, RegistrySkill>,
): boolean {
  return winners.get(skill.name)?.id === skill.id;
}

/**
 * The rows the filter keeps. A skill scoped to another space is not this space's; with no
 * project in hand (the whole environment's registry, and every space until the space-to-project
 * link lands) nothing is another space's, so "this space" keeps everything.
 */
export function filterRegistrySkills(
  skills: readonly RegistrySkill[],
  filter: SkillRegistryFilter,
  projectId: string | undefined,
): readonly RegistrySkill[] {
  switch (filter) {
    case "this-space":
      return skills.filter(
        (skill) =>
          projectId === undefined || skill.projectId === undefined || skill.projectId === projectId,
      );
    case "all":
      return skills;
    case "unused":
      return skills.filter((skill) => skill.usedBy.length === 0);
  }
}

/** `1.8k`, `0.6k`, `900`: what loads when a skill is used. */
export function skillSizeLabel(sizeTokens: number): string {
  if (sizeTokens < 1_000) return String(sizeTokens);

  const thousands = (sizeTokens / 1_000).toFixed(1);

  return `${thousands.endsWith(".0") ? thousands.slice(0, -2) : thousands}k`;
}

const MINUTE_MS = 60_000;

const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * "Just now", "4m ago", "1h ago", "Yesterday", "Never" or "Not indexed". A skill no bot can see
 * is not indexed at all; an indexed one no bot has loaded reads "Never".
 *
 * Spans reuse the app's relative-time wording ({count}m/h/d through "{span} ago", as
 * `relativeRunTime` does) so every locale already phrases them correctly.
 */
export function skillLastLoadedLabel(
  skill: RegistrySkill,
  nowMs: number,
  i18n: SkillTranslator = englishTranslator,
): string {
  if (skill.usedBy.length === 0) return i18n.t("Not indexed");

  if (skill.lastLoadedAt === undefined) return i18n.t("Never");

  const loadedMs = Date.parse(skill.lastLoadedAt);

  if (Number.isNaN(loadedMs)) return i18n.t("Never");

  const elapsed = nowMs - loadedMs;

  if (elapsed < MINUTE_MS) return i18n.t("Just now");

  if (elapsed >= DAY_MS && elapsed < 2 * DAY_MS) return i18n.t("Yesterday");

  const minutes = Math.floor(elapsed / MINUTE_MS);

  const span =
    minutes < 60
      ? i18n.t("{count}m", { count: minutes })
      : minutes < 1440
        ? i18n.t("{count}h", { count: Math.floor(minutes / 60) })
        : i18n.t("{count}d", { count: Math.floor(minutes / 1440) });

  return i18n.t("{span} ago", { span });
}

/** How the Used by cell draws: nothing, one bot as a chip, a short avatar stack, or words. */
export type SkillUsedByPresentation =
  | { readonly kind: "none"; readonly label: string }
  | { readonly kind: "bot"; readonly label: string; readonly botId: BotId }
  | { readonly kind: "stack"; readonly label: string; readonly botIds: readonly BotId[] }
  | { readonly kind: "text"; readonly label: string };

/**
 * Used by keeps one line: one bot as an avatar chip, overlapping avatars for up to three, and
 * words above that — "All spaces" for a skill added to all of them, otherwise the count.
 */
export function skillUsedByPresentation(
  skill: RegistrySkill,
  botNamesById: ReadonlyMap<string, string>,
  i18n: SkillTranslator = englishTranslator,
): SkillUsedByPresentation {
  const names = skill.usedBy.map((botId) => botNamesById.get(botId) ?? botId);

  if (names.length === 0) return { kind: "none", label: i18n.t("No role") };

  if (names.length > 3) {
    return {
      kind: "text",
      label:
        skill.source === "yours"
          ? i18n.t("All spaces")
          : i18n.t("{count} bots", { count: names.length }),
    };
  }

  const onlyBotId = skill.usedBy[0];

  if (names.length === 1 && onlyBotId !== undefined) {
    return { kind: "bot", label: names[0] ?? "", botId: onlyBotId };
  }

  return { kind: "stack", label: names.join(", "), botIds: [...skill.usedBy] };
}

/** The Source badge wording. A skill added to all spaces reads "Yours", not "All spaces". */
export function skillSourceLabel(
  source: SkillSource,
  i18n: SkillTranslator = englishTranslator,
): string {
  switch (source) {
    case "built-in":
      return i18n.t("Built in");
    case "space":
      return i18n.t("Space");
    case "yours":
      return i18n.t("Yours");
    case "community":
      return i18n.t("Community");
    case "provider":
      return i18n.t("Provider");
  }
}

/** A row that needs the user: the Source cell carries the state word and the row grows a line. */
export type SkillAttention =
  | { readonly kind: "needs-approval" }
  | { readonly kind: "changed-since-approved" }
  | { readonly kind: "needs-connector"; readonly connector: string };

/**
 * The one attention state a row shows. Approval wins over a missing connector: until the user
 * approves, the connector does not matter.
 */
export function skillAttention(
  skill: RegistrySkill,
  unavailableConnectors: readonly string[],
): SkillAttention | null {
  if (skill.approval === "needs-approval") {
    return skill.approvalChange === undefined
      ? { kind: "needs-approval" }
      : { kind: "changed-since-approved" };
  }

  const connector = skill.requires.find((id) => unavailableConnectors.includes(id));

  return connector === undefined ? null : { kind: "needs-connector", connector };
}

/** `Added from github.com/acme/recruiting-skills at 4f2a1c9`, without the scheme. */
export function skillOriginLabel(origin: {
  readonly url: string;
  readonly commit: string;
}): string {
  return `${origin.url.replace(/^https?:\/\//, "")} at ${origin.commit}`;
}

/** "browser" reads "Browser" in a badge and in a sentence. */
export function skillConnectorName(connector: string): string {
  return connector.charAt(0).toUpperCase() + connector.slice(1);
}

/**
 * The state word the Source cell carries in place of the source badge. A skill whose content
 * changed after approval is still waiting for the user, so it carries the same word; what
 * changed is told by the warning line under the description.
 */
export function skillAttentionLabel(
  attention: SkillAttention,
  i18n: SkillTranslator = englishTranslator,
): string {
  switch (attention.kind) {
    case "needs-approval":
    case "changed-since-approved":
      return i18n.t("Needs approval");
    case "needs-connector":
      return i18n.t("Needs {connector}", { connector: skillConnectorName(attention.connector) });
  }
}

/** The warning line under the description on a row that needs the user. */
export function skillAttentionDetail(
  skill: RegistrySkill,
  attention: SkillAttention,
  i18n: SkillTranslator = englishTranslator,
): string {
  switch (attention.kind) {
    case "needs-approval": {
      const origin = skill.origin;

      return origin === undefined
        ? i18n.t("A bot cannot use it until you approve it.")
        : i18n.t("Added from {origin} · a bot cannot use it until you approve it.", {
            origin: skillOriginLabel(origin),
          });
    }

    case "changed-since-approved": {
      const change = skill.approvalChange;

      if (change === undefined) return i18n.t("Changed since you approved it.");

      const counts = [
        change.addedFiles > 0 ? i18n.t("{count} file added", { count: change.addedFiles }) : null,
        change.editedFiles > 0 ? i18n.t("{count} edited", { count: change.editedFiles }) : null,
        change.removedFiles > 0 ? i18n.t("{count} removed", { count: change.removedFiles }) : null,
      ].filter((part) => part !== null);

      return i18n.t("Changed at commit {commit} since you approved {approved} · {summary}.", {
        commit: skill.origin?.commit ?? skill.contentHash,
        approved: change.approvedCommit,
        summary: counts.join(", "),
      });
    }

    case "needs-connector":
      return i18n.t(
        "Connect the {connector} connector in Settings › Connections. Until then a bot cannot run this skill.",
        { connector: skillConnectorName(attention.connector) },
      );
  }
}

/** The row's action label: what the user does about the state it is in. */
export function skillAttentionActionLabel(
  attention: SkillAttention,
  i18n: SkillTranslator = englishTranslator,
): string {
  switch (attention.kind) {
    case "needs-approval":
      return i18n.t("Approve");
    case "changed-since-approved":
      return i18n.t("Review");
    case "needs-connector":
      return i18n.t("Connect");
  }
}
