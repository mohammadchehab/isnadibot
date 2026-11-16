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

/** One file an approval lists: its path inside the skill's folder, and what it costs to load. */
export type SkillFilePreview = {
  readonly path: string;
  readonly sizeTokens: number;
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
  /** The `SKILL.md` body the approval dialog shows. Phase-0 addition, recorded with `origin`. */
  readonly instructions?: string;
  /** The files the approval dialog lists under the instructions. Phase-0 addition. */
  readonly files?: readonly SkillFilePreview[];
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

/** How a skill enters the registry: copied from a provider, a GitHub folder, or an uploaded .zip. */
export type SkillAddSource = "provider" | "github" | "zip";

/** Where an added skill lands: this space's folder, or the user's, which every space sees. */
export type SkillAddScope = "this-space" | "all-spaces";

/** Why an add was refused. Each refusal is one drawn error state in the Add a skill dialog. */
export type SkillAddRefusal = "link-not-found" | "zip-too-big" | "bad-archive";

/** What the Add a skill dialog asks for. */
export type SkillAddRequest = {
  readonly source: SkillAddSource;
  readonly scope: SkillAddScope;
  /** The provider skill id, the GitHub URL, or the chosen archive's name. */
  readonly input: string;
  /** The chosen archive's size in bytes; only `zip` carries it. */
  readonly sizeBytes?: number;
  /** The archive's first two bytes, so a file that is not a zip is refused like the server does. */
  readonly leadingBytes?: readonly number[];
};

/**
 * `needs-approval` is a Community skill that was added and now waits for the user, so the
 * Add a skill dialog hands over to the approval dialog rather than closing.
 */
export type SkillAddOutcome =
  | { readonly kind: "added"; readonly skillId: SkillId }
  | { readonly kind: "needs-approval"; readonly skillId: SkillId }
  | { readonly kind: "refused"; readonly refusal: SkillAddRefusal };

/**
 * The writes the skills screens ask for. Phase 1 maps each one onto its command; the screens
 * call these and never a transport.
 */
export type SkillRegistryActions = {
  addSkill(request: SkillAddRequest): SkillAddOutcome;
  approveSkill(skillId: SkillId): void;
  removeSkill(skillId: SkillId): void;
};

/**
 * The one source of skill data behind the seam. Phase 1 replaces the implementation with an
 * `skills.list` subscription; no screen changes. `actions` is absent on a source that cannot
 * be written to, and the screens then draw their buttons inert rather than hiding them.
 */
export type SkillRegistrySource = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SkillRegistrySnapshot;
  readonly actions?: SkillRegistryActions;
};
