import * as NodeFS from "node:fs";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import type { LinkCheckBrokenLink, LinkCheckReport } from "@isnadi/contracts";

import {
  planLinkFixes,
  type Fix,
  type FixPlannerFiles,
  type LinkFixPlan,
  type Unfixable,
} from "./fixPlan.ts";
import { resolveReportRedirects } from "./redirects.ts";
import { isWithinPath, type SiteDocs } from "./sitePages.ts";

/**
 * The bot opens this PR with nobody watching, so every rule below is a refusal
 * rather than a repair: a destination it cannot prove is safe is a destination
 * it does not write. The refusals are the feature.
 */
export const FixPrRefusal = [
  "target-not-granted",
  "docs-outside-repo",
  "protected-branch",
  "edit-outside-docs",
  "pr-already-open",
] as const;

export type FixPrRefusal = (typeof FixPrRefusal)[number];

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one command in `cwd`. Injected so the envelope is testable without a network. */
export class CommandExecutor extends Context.Service<
  CommandExecutor,
  {
    readonly run: (
      command: string,
      args: ReadonlyArray<string>,
      cwd: string,
    ) => Effect.Effect<CommandResult>;
  }
>()("isnadibot/link-monitor/fixPr/CommandExecutor") {}

/** Branch `main` and its aliases are the one thing a bot may never push to. */
const PROTECTED_BRANCHES = new Set(["main", "master", "head", "trunk", "develop", "release"]);

export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.has(branch.trim().toLowerCase());
}

/** The branch a run publishes on: namespaced, dated, and never a protected name. */
export function fixPrBranch(now: Date): string {
  const stamp = now.toISOString().slice(0, 19).replaceAll(/[:T]/g, "-");

  return `link-monitor/fix-links-${stamp}`;
}

export interface OpenFixPrInput {
  /** Absolute path of the repository the user granted the bot. */
  readonly grantedRepo: string;
  /** Absolute path of the checkout the run works in; must be the granted repo. */
  readonly repo: string;
  /** Repo-relative root the monitor was pointed at. Nothing outside it is editable. */
  readonly docsRoot: string;
  readonly branch: string;
  readonly plan: LinkFixPlan;
  readonly site: string;
  readonly base: string;
}

export type OpenFixPrResult =
  | { readonly kind: "opened"; readonly branch: string; readonly url: string }
  | { readonly kind: "nothing-to-fix" }
  | { readonly kind: "refused"; readonly refusal: FixPrRefusal };

/**
 * Checks everything that can be checked before a single byte is written, and
 * returns the first refusal. Separate from publishing so a caller (and a test)
 * can see the verdict without side effects.
 */
export function checkFixPr(input: OpenFixPrInput): FixPrRefusal | null {
  if (!isWithinPath(input.grantedRepo, input.repo)) return "target-not-granted";

  if (!isWithinPath(input.repo, `${input.repo}/${input.docsRoot}`)) return "docs-outside-repo";

  if (isProtectedBranch(input.branch)) return "protected-branch";

  for (const edit of input.plan.edits) {
    if (!isWithinPath(input.docsRoot, edit.path)) return "edit-outside-docs";
  }

  return null;
}

/** The PR body: what changed, and every link that was deliberately left alone. */
export function fixPrBody(plan: LinkFixPlan): string {
  const fixed =
    plan.fixes.length === 0
      ? "- None."
      : plan.fixes
          .map(
            (fix) =>
              `- \`${fix.sourcePath}\`: \`${fix.from}\` → \`${fix.to}\` (${describeFix(fix)})`,
          )
          .join("\n");

  const unfixable =
    plan.unfixable.length === 0
      ? "- None."
      : plan.unfixable
          .map(
            (entry: Unfixable) =>
              `- \`${entry.link.targetUrl}\` in \`${entry.link.sourcePage}\` — ${entry.reason}`,
          )
          .join("\n");

  return [
    "The link monitor found broken links in these docs and fixed the ones it could verify.",
    "",
    "## Fixed",
    "",
    fixed,
    "",
    "## Not fixed",
    "",
    "These need a person: the monitor only rewrites a link to a file it can see, and never to a",
    "destination outside the docs it was pointed at.",
    "",
    unfixable,
  ].join("\n");
}

function describeFix(fix: Fix): string {
  switch (fix.kind) {
    case "redirect":
      return "the old address redirects here";
    case "repath":
      return "the page moved";
    case "drop-anchor":
      return "the section no longer exists, so it links the page";
  }
}

/**
 * Publishes the plan as a PR on its own branch. The order is deliberate: the
 * open-PR check comes before any write, the commit is staged path by path, and
 * the push names its destination explicitly so no repository setting can turn
 * it into a push to the protected branch.
 */
export const openFixPr = Effect.fn("linkMonitor.openFixPr")(function* (input: OpenFixPrInput) {
  const refusal = checkFixPr(input);

  if (refusal !== null) {
    return { kind: "refused", refusal } satisfies OpenFixPrResult;
  }

  if (input.plan.edits.length === 0) {
    return { kind: "nothing-to-fix" } satisfies OpenFixPrResult;
  }

  return yield* Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const executor = yield* CommandExecutor;

    const run = (command: string, args: ReadonlyArray<string>) =>
      executor.run(command, args, input.repo);

    // One open PR at a time: a second run must add to the existing PR rather than
    // open a rival branch nobody will merge.
    const open = yield* run("gh", [
      "pr",
      "list",
      "--head",
      input.branch,
      "--state",
      "open",
      "--json",
      "number",
    ]);

    if (open.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("gh", open));
    }

    if (open.stdout.trim() !== "[]" && open.stdout.trim() !== "") {
      return { kind: "refused", refusal: "pr-already-open" } satisfies OpenFixPrResult;
    }

    const created = yield* run("git", ["switch", "-c", input.branch]);

    if (created.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("git switch", created));
    }

    for (const edit of input.plan.edits) {
      if (!isWithinPath(input.docsRoot, edit.path)) {
        return { kind: "refused", refusal: "edit-outside-docs" } satisfies OpenFixPrResult;
      }

      yield* fs.writeFileString(`${input.repo}/${edit.path}`, edit.content);
    }

    const staged = yield* run("git", ["add", "--", ...input.plan.edits.map((edit) => edit.path)]);

    if (staged.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("git add", staged));
    }

    const committed = yield* run("git", [
      "commit",
      "-m",
      `fix(docs): repair ${input.plan.fixes.length} broken link${input.plan.fixes.length === 1 ? "" : "s"}`,
    ]);

    if (committed.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("git commit", committed));
    }

    // Explicit refspec, protected destination already ruled out above.
    const pushed = yield* run("git", ["push", "origin", `HEAD:refs/heads/${input.branch}`]);

    if (pushed.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("git push", pushed));
    }

    const created1 = yield* run("gh", [
      "pr",
      "create",
      "--head",
      input.branch,
      "--base",
      input.base,
      "--title",
      `fix(docs): ${input.plan.fixes.length} broken link${input.plan.fixes.length === 1 ? "" : "s"} on ${input.site}`,
      "--body",
      fixPrBody(input.plan),
    ]);

    if (created1.code !== 0) {
      return yield* Effect.fail(new FixPrCommandError("gh pr create", created1));
    }

    return {
      kind: "opened",
      branch: input.branch,
      url: created1.stdout.trim(),
    } satisfies OpenFixPrResult;
  });
});

/** A command the fixer needed and could not run, kept together with its output. */
export class FixPrCommandError extends Error {
  readonly command: string;
  readonly result: CommandResult;

  constructor(command: string, result: CommandResult) {
    super(`${command} failed with exit code ${result.code}: ${result.stderr.trim()}`);
    this.name = "FixPrCommandError";
    this.command = command;
    this.result = result;
  }
}

/** Groups links the fixer left alone by reason, for a caller that wants a count. */
export function unfixableByReason(
  plan: LinkFixPlan,
): ReadonlyMap<Unfixable["reason"], ReadonlyArray<LinkCheckBrokenLink>> {
  const grouped = new Map<Unfixable["reason"], LinkCheckBrokenLink[]>();

  for (const entry of plan.unfixable) {
    const existing = grouped.get(entry.reason);

    if (existing === undefined) grouped.set(entry.reason, [entry.link]);
    else existing.push(entry.link);
  }

  return grouped;
}

/**
 * Turns one run's report into a plan: follows the redirects a report cannot
 * describe, then plans every repair against the docs tree being crawled.
 */
export const planReportFixes = Effect.fn("linkMonitor.planReportFixes")(function* (input: {
  readonly report: LinkCheckReport;
  readonly docs: SiteDocs;
  readonly files: FixPlannerFiles;
}) {
  const redirects = yield* resolveReportRedirects({
    siteUrl: input.docs.siteUrl,
    links: input.report.brokenLinks,
  });

  return planLinkFixes({
    docs: input.docs,
    links: input.report.brokenLinks,
    redirects,
    files: input.files,
  });
});

/**
 * The planner's view of a real checkout: every file below the docs root, and a
 * read that answers null rather than failing, because an unreadable candidate
 * is simply not a candidate.
 */
export const checkoutPlannerFiles = Effect.fn("linkMonitor.checkoutPlannerFiles")(
  function* (input: { readonly repo: string; readonly docsRoot: string }) {
    const fs = yield* FileSystem.FileSystem;
    const root = `${input.repo}/${input.docsRoot}`;

    const walk = (directory: string, prefix: string): Effect.Effect<ReadonlyArray<string>> =>
      Effect.gen(function* () {
        const entries = yield* fs.readDirectory(directory);
        const found: string[] = [];

        for (const entry of entries) {
          const relative = prefix.length === 0 ? entry : `${prefix}/${entry}`;
          const info = yield* fs.stat(`${directory}/${entry}`);

          if (info.type === "Directory") {
            found.push(...(yield* walk(`${directory}/${entry}`, relative)));
            continue;
          }

          found.push(`${input.docsRoot}/${relative}`);
        }

        return found;
      });

    const listed = yield* walk(root, "");

    return {
      listDocsFiles: () => listed,
      // A page the planner cannot read is a page it cannot argue with, so the
      // failure is an absence here rather than an error that ends the run.
      readText: (repoRelativePath: string) => {
        try {
          return NodeFS.readFileSync(`${input.repo}/${repoRelativePath}`, "utf8");
        } catch {
          return null;
        }
      },
    } satisfies FixPlannerFiles;
  },
);
