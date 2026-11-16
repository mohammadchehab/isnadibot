import { BotId, ProjectId, SkillId } from "@isnadi/contracts";
import { DateTime } from "effect";

import { skillAddNameFromUrl, skillAddZipRefusal } from "./skillAdd.ts";
import type {
  RegistrySkill,
  SkillAddOutcome,
  SkillAddRequest,
  SkillRegistrySnapshot,
  SkillRegistrySource,
} from "./types.ts";

/** Which registry the dev fixture shows; the web entry reads it from `?skills=`. */
export const SKILL_FIXTURE_SCENARIOS = ["full", "empty", "loading", "error"] as const;

export type SkillFixtureScenario = (typeof SKILL_FIXTURE_SCENARIOS)[number];

/** The space the fixture's space-scoped skills belong to. */
export const SKILL_FIXTURE_PROJECT_ID = ProjectId.make("space-recruiting");

/** Bot ids the fixture's Used by column names, so a screen can resolve avatars. */
export const SKILL_FIXTURE_BOT_IDS = {
  scout: BotId.make("bot-scout"),
  tailor: BotId.make("bot-tailor"),
  tracker: BotId.make("bot-tracker"),
  coach: BotId.make("bot-coach"),
} as const;

const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

function ago(nowMs: number, elapsedMs: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(nowMs - elapsedMs));
}

const { scout, tailor, tracker, coach } = SKILL_FIXTURE_BOT_IDS;

/**
 * A short `SKILL.md` body and file list, so the approval dialog has real content to draw for
 * every Community skill that waits for the user.
 */
function skillPreview(
  name: string,
  description: string,
): Pick<RegistrySkill, "instructions" | "files"> {
  return {
    instructions: [
      `# ${name}`,
      description,
      "",
      "1. Read the space's own data before reaching outside it.",
      "2. Say which source answered, and say so when none did.",
      "3. Never message anyone from this skill.",
    ].join("\n"),
    files: [
      { path: "SKILL.md", sizeTokens: 1_400 },
      { path: "references/scoring.md", sizeTokens: 2_100 },
      { path: "scripts/search.md", sizeTokens: 900 },
    ],
  };
}

/**
 * Every state the design notes ask a reviewer to click: all five sources, a name found twice
 * with the space copy winning, Community skills needing approval, approved, and changed since
 * approval, a skill whose connector is missing, and rows no bot uses.
 *
 * Copy and numbers are the frames' (3a, 3i and the notes sheet); timestamps are relative to
 * `nowMs` so the Last loaded column reads the same on every run.
 */
function fullRegistry(nowMs: number): SkillRegistrySnapshot {
  const skills: readonly RegistrySkill[] = [
    {
      id: SkillId.make("built-in:all:candidate-search"),
      name: "candidate-search",
      description: "Search job boards for candidates who match an opening.",
      source: "built-in",
      sizeTokens: 1_800,
      fileCount: 3,
      contentHash: "a1b2c3d",
      approval: "not-needed",
      requires: [],
      usedBy: [scout],
      lastLoadedAt: ago(nowMs, 4 * MINUTE_MS),
    },
    {
      id: SkillId.make("space:recruiting:job-posting"),
      name: "job-posting",
      description:
        "Post and update openings on job boards. Stops at sign-in, payment, or anything it cannot verify.",
      source: "space",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 2_400,
      fileCount: 4,
      contentHash: "b2c3d4e",
      approval: "not-needed",
      requires: [],
      usedBy: [scout],
      lastLoadedAt: ago(nowMs, 12 * MINUTE_MS),
    },
    {
      // The same name as the space copy, so the list can mark which one the index uses.
      id: SkillId.make("yours:all:job-posting"),
      name: "job-posting",
      description: "Post and update openings on job boards, from your own folder.",
      source: "yours",
      sizeTokens: 2_200,
      fileCount: 3,
      contentHash: "c3d4e5f",
      approval: "not-needed",
      requires: [],
      usedBy: [tailor],
      lastLoadedAt: ago(nowMs, 2 * DAY_MS),
    },
    {
      id: SkillId.make("built-in:all:site-sign-in"),
      name: "site-sign-in",
      description: "Ask you to sign in to a site before the bot continues.",
      source: "built-in",
      sizeTokens: 600,
      fileCount: 2,
      contentHash: "d4e5f60",
      approval: "not-needed",
      requires: ["browser"],
      usedBy: [scout],
      lastLoadedAt: ago(nowMs, 12 * MINUTE_MS),
    },
    {
      id: SkillId.make("space:recruiting:job-description"),
      name: "job-description",
      description: "Write a job description from a hiring brief.",
      source: "space",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 3_100,
      fileCount: 5,
      contentHash: "e5f6071",
      approval: "not-needed",
      requires: [],
      usedBy: [tailor],
      lastLoadedAt: ago(nowMs, HOUR_MS),
    },
    {
      id: SkillId.make("space:recruiting:outreach-message"),
      name: "outreach-message",
      description: "Draft a short outreach message to a candidate.",
      source: "space",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 1_200,
      fileCount: 2,
      contentHash: "f607182",
      approval: "not-needed",
      requires: [],
      usedBy: [tailor],
      lastLoadedAt: ago(nowMs, HOUR_MS),
    },
    {
      id: SkillId.make("built-in:all:pipeline-update"),
      name: "pipeline-update",
      description: "Move candidates between board columns and record why.",
      source: "built-in",
      sizeTokens: 900,
      fileCount: 2,
      contentHash: "0718293",
      approval: "not-needed",
      requires: [],
      usedBy: [tracker],
      lastLoadedAt: ago(nowMs, 10_000),
    },
    {
      id: SkillId.make("space:recruiting:follow-up-email"),
      name: "follow-up-email",
      description: "Draft a follow-up after seven days without a reply.",
      source: "space",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 700,
      fileCount: 2,
      contentHash: "1829304",
      approval: "not-needed",
      requires: [],
      usedBy: [scout, tailor, tracker],
      lastLoadedAt: ago(nowMs, DAY_MS + HOUR_MS),
    },
    {
      id: SkillId.make("community:recruiting:interview-kit"),
      name: "interview-kit",
      description: "Build a question set and scorecard for an opening.",
      source: "community",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 2_600,
      fileCount: 4,
      contentHash: "2930415",
      approval: "approved",
      requires: [],
      usedBy: [coach],
      origin: { url: "https://github.com/acme/recruiting-skills", commit: "9b31e07" },
    },
    {
      id: SkillId.make("built-in:all:video-cut-list"),
      name: "video-cut-list",
      description: "Turn a transcript into a timed cut list.",
      source: "built-in",
      sizeTokens: 1_400,
      fileCount: 2,
      contentHash: "3041526",
      approval: "not-needed",
      requires: [],
      usedBy: [],
    },
    {
      id: SkillId.make("community:recruiting:salary-benchmark"),
      name: "salary-benchmark",
      description: "Compare a candidate's pay to the band for the role.",
      source: "community",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 2_400,
      fileCount: 3,
      contentHash: "4f2a1c9",
      approval: "needs-approval",
      requires: [],
      usedBy: [scout, tailor, coach],
      origin: { url: "https://github.com/acme/recruiting-skills", commit: "4f2a1c9" },
      ...skillPreview("salary-benchmark", "Compare a candidate's pay to the band for the role."),
    },
    {
      id: SkillId.make("community:recruiting:comp-bands"),
      name: "comp-bands",
      description: "Read the pay bands a role's offers must stay inside.",
      source: "community",
      projectId: SKILL_FIXTURE_PROJECT_ID,
      sizeTokens: 1_600,
      fileCount: 3,
      contentHash: "9b31e07",
      approval: "needs-approval",
      requires: [],
      usedBy: [tailor],
      origin: { url: "https://github.com/acme/recruiting-skills", commit: "9b31e07" },
      approvalChange: {
        approvedCommit: "4f2a1c9",
        addedFiles: 1,
        editedFiles: 2,
        removedFiles: 0,
      },
      ...skillPreview("comp-bands", "Read the pay bands a role's offers must stay inside."),
    },
    {
      id: SkillId.make("yours:all:tone-of-voice"),
      name: "tone-of-voice",
      description: "Added to all spaces, so every bot here can load it.",
      source: "yours",
      sizeTokens: 600,
      fileCount: 1,
      contentHash: "5263748",
      approval: "not-needed",
      requires: [],
      usedBy: [scout, tailor, tracker, coach],
      lastLoadedAt: ago(nowMs, HOUR_MS),
    },
    {
      id: SkillId.make("provider:all:browser-scrape"),
      name: "browser-scrape",
      description: "Open a job board in the browser and read the listings it shows.",
      source: "provider",
      providerDriver: "codex",
      sizeTokens: 1_900,
      fileCount: 3,
      contentHash: "6374859",
      approval: "not-needed",
      requires: ["browser"],
      usedBy: [coach],
      lastLoadedAt: ago(nowMs, 3 * HOUR_MS),
    },
    {
      id: SkillId.make("provider:all:codex-review"),
      name: "codex-review",
      description: "Review a pull request against the team's checklist.",
      source: "provider",
      providerDriver: "codex",
      sizeTokens: 1_100,
      fileCount: 2,
      contentHash: "7485960",
      approval: "not-needed",
      requires: [],
      usedBy: [tracker],
      lastLoadedAt: ago(nowMs, 5 * HOUR_MS),
    },
  ];

  return { state: "ready", skills, unavailableConnectors: ["browser"] };
}

function snapshotFor(scenario: SkillFixtureScenario, nowMs: number): SkillRegistrySnapshot {
  switch (scenario) {
    case "full":
      return fullRegistry(nowMs);
    case "empty":
      return { state: "ready", skills: [], unavailableConnectors: [] };
    case "loading":
      return { state: "loading", skills: [], unavailableConnectors: [] };
    case "error":
      return { state: "error", skills: [], unavailableConnectors: [] };
  }
}

const SCOPE_SOURCE = { "this-space": "space", "all-spaces": "yours" } as const;

const SCOPE_ID = { "this-space": "recruiting", "all-spaces": "all" } as const;

/** A stable seven-character commit for an added skill, so a reviewed dialog reads the same twice. */
function fixtureCommit(name: string): string {
  let hash = 7;

  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 0xfffffff;

  return hash.toString(16).padStart(7, "0").slice(0, 7);
}

/**
 * The DEV-only registry source. With `dev` false it is the empty source: the screens read
 * `unavailable` and render nothing, which is what a shipped build must do. The flag is passed
 * in by the platform entry, never read here — React Native has no `import.meta.env`.
 *
 * The dev source is writable: the dialogs add, approve and remove skills and every screen
 * subscribed to it redraws, which is what lets the screens be reviewed end to end before the
 * server seam lands. Nothing here survives a reload.
 */
export function createSkillRegistryFixture(options: {
  readonly dev: boolean;
  readonly scenario?: SkillFixtureScenario;
  readonly nowMs?: number;
}): SkillRegistrySource {
  if (!options.dev) {
    const snapshot: SkillRegistrySnapshot = {
      state: "unavailable",
      skills: [],
      unavailableConnectors: [],
    };

    return { subscribe: () => () => undefined, getSnapshot: () => snapshot };
  }

  let snapshot = snapshotFor(
    options.scenario ?? "full",
    options.nowMs ?? DateTime.toEpochMillis(DateTime.nowUnsafe()),
  );

  const listeners = new Set<() => void>();

  const publish = (skills: readonly RegistrySkill[]): void => {
    snapshot = { ...snapshot, skills };

    // A copy, so a listener that unsubscribes cannot change the list mid-loop.
    for (const listener of Array.from(listeners)) listener();
  };

  /**
   * A folder the fixture knows is one whose skill the registry already lists, because the
   * fixture cannot fetch anything. An unknown name is refused the way the server refuses it,
   * with the refusal each dialog draws.
   */
  const addSkill = (request: SkillAddRequest): SkillAddOutcome => {
    if (request.source === "zip") {
      const refusal = skillAddZipRefusal(request);

      if (refusal !== null) return { kind: "refused", refusal };
    }

    const original =
      request.source === "provider"
        ? snapshot.skills.find((skill) => skill.id === request.input)
        : undefined;

    const name =
      original?.name ??
      (request.source === "zip"
        ? request.input.replace(/\.zip$/i, "")
        : skillAddNameFromUrl(request.input));

    if (name === undefined || name === "") {
      return {
        kind: "refused",
        refusal: request.source === "zip" ? "bad-archive" : "link-not-found",
      };
    }

    if (request.source !== "provider" && !snapshot.skills.some((skill) => skill.name === name)) {
      return {
        kind: "refused",
        refusal: request.source === "github" ? "link-not-found" : "bad-archive",
      };
    }

    const source = request.source === "provider" ? SCOPE_SOURCE[request.scope] : "community";
    const skillId = SkillId.make(`${source}:${SCOPE_ID[request.scope]}:${name}`);
    const commit = fixtureCommit(name);
    const description = original?.description ?? "Added from a folder you chose.";

    const added: RegistrySkill = {
      id: skillId,
      name,
      description,
      source,
      ...(request.scope === "this-space" ? { projectId: SKILL_FIXTURE_PROJECT_ID } : {}),
      ...(source === "community" ? { origin: { url: request.input, commit } } : {}),
      sizeTokens: original?.sizeTokens ?? 1_200,
      fileCount: original?.fileCount ?? 3,
      contentHash: commit,
      approval: source === "community" ? "needs-approval" : "not-needed",
      requires: original?.requires ?? [],
      usedBy: [],
      ...(source === "community" ? skillPreview(name, description) : {}),
    };

    publish([...snapshot.skills, added]);

    return source === "community"
      ? { kind: "needs-approval", skillId }
      : { kind: "added", skillId };
  };

  const approveSkill = (skillId: SkillId): void => {
    publish(
      snapshot.skills.map((skill) =>
        // The change record stays: it says what changed at the commit that was just approved.
        skill.id === skillId ? { ...skill, approval: "approved" as const } : skill,
      ),
    );
  };

  const removeSkill = (skillId: SkillId): void => {
    publish(snapshot.skills.filter((skill) => skill.id !== skillId));
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    actions: { addSkill, approveSkill, removeSkill },
  };
}
