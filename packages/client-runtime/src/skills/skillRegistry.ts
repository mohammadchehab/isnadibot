import type { BotSkill } from "@isnadi/contracts";
import { useMemo, useSyncExternalStore } from "react";

import type {
  RegistrySkill,
  SkillRegistryActions,
  SkillRegistrySnapshot,
  SkillRegistrySource,
} from "./types.ts";

/**
 * The seam every skills screen reads. No screen calls `skills.list` or `bot.update` itself:
 * phase 1 swaps this module's source for the RPC subscription and no screen changes.
 *
 * The source is registered once per platform entry (web and desktop: `import.meta.env.DEV`;
 * mobile: `__DEV__`), never inside this package, because React Native has no
 * `import.meta.env`. With no source registered the snapshot is `unavailable` and the screens
 * and navigation rows that own them render nothing.
 */

const UNAVAILABLE_SNAPSHOT: SkillRegistrySnapshot = {
  state: "unavailable",
  skills: [],
  unavailableConnectors: [],
};

const UNAVAILABLE_SOURCE: SkillRegistrySource = {
  subscribe: () => () => undefined,
  getSnapshot: () => UNAVAILABLE_SNAPSHOT,
};

let registeredSource: SkillRegistrySource | null = null;

const sourceListeners = new Set<() => void>();

/**
 * Registers the platform's source. Called from the platform entry, and again with `null` by a
 * test that wants the shipped behaviour back.
 */
export function registerSkillRegistrySource(source: SkillRegistrySource | null): void {
  registeredSource = source;

  // A copy, so a listener that registers another source cannot change the list mid-loop.
  for (const listener of Array.from(sourceListeners)) listener();
}

function subscribeToRegisteredSource(listener: () => void): () => void {
  sourceListeners.add(listener);

  return () => {
    sourceListeners.delete(listener);
  };
}

function getRegisteredSource(): SkillRegistrySource {
  return registeredSource ?? UNAVAILABLE_SOURCE;
}

/** The registry snapshot. Screens given `unavailable` render nothing. */
export function useSkillRegistry(): SkillRegistrySnapshot {
  const source = useSyncExternalStore(
    subscribeToRegisteredSource,
    getRegisteredSource,
    getRegisteredSource,
  );

  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

/**
 * The writes behind the seam, or null on a source that cannot be written to. A screen reads
 * this to decide whether its Add, Approve and Remove controls do anything.
 */
export function useSkillRegistryActions(): SkillRegistryActions | null {
  const source = useSyncExternalStore(
    subscribeToRegisteredSource,
    getRegisteredSource,
    getRegisteredSource,
  );

  return source.actions ?? null;
}

/** One entry of a bot's skill set, joined to its registry row. */
export type BotSkillEntry = {
  readonly skillId: BotSkill["skillId"];
  readonly enabled: boolean;
  /** The registry row, or undefined while the registry does not list this id. */
  readonly skill: RegistrySkill | undefined;
};

/** A bot's set resolved against the registry, plus the "use other skills" switch. */
export type BotSkillsView = {
  readonly state: SkillRegistrySnapshot["state"];
  readonly entries: readonly BotSkillEntry[];
  readonly registryAccess: boolean;
};

/**
 * The bot's own skill set, each entry joined to the registry row that names and describes it.
 * A bot given no skills has an empty set rather than an undefined one.
 */
export function useBotSkills(bot: {
  readonly skills?: readonly BotSkill[] | undefined;
  readonly skillRegistryAccess?: boolean | undefined;
}): BotSkillsView {
  const registry = useSkillRegistry();
  const botSkills = bot.skills;
  const registryAccess = bot.skillRegistryAccess ?? false;

  return useMemo(() => {
    const byId = new Map(registry.skills.map((skill) => [skill.id, skill]));

    return {
      state: registry.state,
      entries: (botSkills ?? []).map((skill) => ({
        skillId: skill.skillId,
        enabled: skill.enabled,
        skill: byId.get(skill.skillId),
      })),
      registryAccess,
    };
  }, [botSkills, registry, registryAccess]);
}
