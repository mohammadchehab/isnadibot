import type { BotId, ProjectId, SkillId } from "@isnadi/contracts";

/** Where a skill's files live; one secondary badge per registry row. */
export type SkillSource = "built-in" | "space" | "yours" | "community" | "provider";

/**
 * Whether a bot may use the skill. `needs-approval` covers both a Community skill that was
 * never approved and one whose files changed after approval (D28); `approvalChange` tells the
 * two apart when a previous approval exists.
 */
export type SkillApproval = "not-needed" | "approved" | "needs-approval";

/** The URL and commit a Community skill was imported from. */
export type SkillOrigin = {
  readonly url: string;
  readonly commit: string;
};

/** What changed since the approved commit, for the "changed since approved" row and its dialog. */
export type SkillApprovalChange = {
  readonly approvedCommit: string;
  readonly addedFiles: number;
  readonly editedFiles: number;
  readonly removedFiles: number;
};

/**
 * One registry row, field for field with the `RegistrySkill` contract block in
 * docs/internals/skills-registry.md.
 *
 * Delete this type and import the contract's when `packages/contracts/src/skills.ts` lands
 * (phase 1, behind the go gate). `origin` and `approvalChange` are phase-0 additions: the
 * contract block cannot express the "changed since approved" row that design notes item 2
 * draws, nor where a Community skill came from. Both are recorded on TASK-448 for the
 * contract's first cut.
 */
export type RegistrySkill = {
  readonly id: SkillId;
  readonly name: string;
  readonly description: string;
  readonly source: SkillSource;
  readonly projectId?: ProjectId;
  readonly providerDriver?: string;
  readonly sizeTokens: number;
  readonly fileCount: number;
  readonly contentHash: string;
  readonly approval: SkillApproval;
  readonly requires: readonly string[];
  readonly usedBy: readonly BotId[];
  /** ISO timestamp of the last load, or absent for a skill no bot has loaded yet. */
  readonly lastLoadedAt?: string;
  readonly origin?: SkillOrigin;
  readonly approvalChange?: SkillApprovalChange;
};

/**
 * `unavailable` means no registry source is registered on this platform, so the screens and
 * the navigation rows that own them render nothing. `loading` and `error` are states of a
 * registered source.
 */
export type SkillRegistryState = "unavailable" | "loading" | "ready" | "error";

/** Everything the skills screens read, in one value. */
export type SkillRegistrySnapshot = {
  readonly state: SkillRegistryState;
  readonly skills: readonly RegistrySkill[];
  /** Connector ids the environment has no healthy copy of; drives "Needs <connector>". */
  readonly unavailableConnectors: readonly string[];
};

/**
 * The one source of skill data behind the seam. Phase 1 replaces the implementation with an
 * `skills.list` subscription; no screen changes.
 */
export type SkillRegistrySource = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SkillRegistrySnapshot;
};
