import type { LinkCheckBrokenLink } from "@isnadi/contracts";
import * as Predicate from "effect/Predicate";

import {
  isWithinPath,
  linkKey,
  pageCandidates,
  repoPathForPage,
  resolvePageAddress,
  splitAddress,
  type SiteDocs,
} from "./sitePages.ts";

/**
 * How a link was repaired, so the PR body can say what it changed rather than
 * only that it changed something.
 */
export const FixKind = ["redirect", "repath", "drop-anchor"] as const;

export type FixKind = (typeof FixKind)[number];

/** Why a link was left alone. Every one names a case the fixer refuses to guess at. */
export const UnfixableReason = [
  "external",
  "outside-docs",
  "no-candidate",
  "ambiguous-candidate",
  "unresolvable-target",
] as const;

export type UnfixableReason = (typeof UnfixableReason)[number];

export interface Fix {
  readonly sourcePath: string;
  readonly from: string;
  readonly to: string;
  readonly kind: FixKind;
}

export interface Unfixable {
  readonly link: LinkCheckBrokenLink;
  readonly reason: UnfixableReason;
}

export interface FileEdit {
  readonly path: string;
  readonly content: string;
}

export interface LinkFixPlan {
  readonly edits: ReadonlyArray<FileEdit>;
  readonly fixes: ReadonlyArray<Fix>;
  readonly unfixable: ReadonlyArray<Unfixable>;
}

/**
 * The filesystem the planner reads, addressed with repo-relative paths so no
 * step of planning can reach outside the repository the report describes.
 */
export interface FixPlannerFiles {
  /** Every file under the docs root, repo-relative, for candidate matching. */
  readonly listDocsFiles: () => ReadonlyArray<string>;
  readonly readText: (repoRelativePath: string) => string | null;
}

export interface PlanLinkFixesInput {
  readonly docs: SiteDocs;
  readonly links: ReadonlyArray<LinkCheckBrokenLink>;
  /**
   * Where each redirecting link landed, keyed by `linkKey`. A report carries the
   * status a link answered with but not the address it pointed at, so the
   * envelope follows those redirects and hands the answers in here.
   */
  readonly redirects: ReadonlyMap<string, string>;
  readonly files: FixPlannerFiles;
}

/**
 * Plans the edits that repair what can be repaired and names the rest. Pure: it
 * writes nothing and runs no command, so a plan can be inspected, tested, and
 * refused before any branch exists.
 *
 * A rewrite only ever happens for a link that points inside the docs root, and
 * only to a file that exists there. Everything else is reported, which keeps
 * the fixer from inventing a destination it cannot verify.
 */
export function planLinkFixes(input: PlanLinkFixesInput): LinkFixPlan {
  const docsFiles = input.files.listDocsFiles();
  const byBasename = new Map<string, string[]>();

  for (const file of docsFiles) {
    const name = basename(file);
    const existing = byBasename.get(name);

    if (existing === undefined) byBasename.set(name, [file]);
    else existing.push(file);
  }

  const exists = (path: string) => input.files.readText(path) !== null;

  const fixes: Fix[] = [];
  const unfixable: Unfixable[] = [];
  // One entry per source file, so a second fix in the same file extends the
  // content rather than writing over the first.
  const editsByPath = new Map<string, string>();

  const decideRedirect = (
    sourcePath: string,
    location: string,
    anchor: string | null,
  ): { to: string; kind: FixKind } | UnfixableReason => {
    const destination = repoPathForPage(input.docs, location, exists);

    if (destination === null) {
      // A redirect out of the docs tree is a deliberate refusal; one into a page
      // the fixer cannot find is a report, not an edit.
      return isOutsideDocs(input.docs, location) ? "outside-docs" : "no-candidate";
    }

    const suffix = anchor === null ? "" : `#${anchor}`;

    return { to: `${relativeLink(sourcePath, destination)}${suffix}`, kind: "redirect" };
  };

  const decide = (link: LinkCheckBrokenLink): { to: string; kind: FixKind } | UnfixableReason => {
    const { path: targetPath, anchor } = splitAddress(link.targetUrl);

    if (!isInternalTarget(link.targetUrl)) return "external";

    const sourcePath = repoPathForPage(input.docs, link.sourcePage, exists);

    if (sourcePath === null) return "unresolvable-target";

    // A bare `#anchor` asks for another section of the page it sits on; there is
    // no file to repair and no heading the fixer can prove is the right one.
    if (targetPath.length === 0) return "unresolvable-target";

    const redirect = input.redirects.get(linkKey(link));

    if (redirect !== undefined) return decideRedirect(sourcePath, redirect, anchor);

    const resolved = resolvePageAddress(link.sourcePage, targetPath);
    const file = repoPathForPage(input.docs, resolved, exists);

    if (file !== null) {
      // The file is there, so this was only ever about the fragment.
      return anchor === null
        ? "unresolvable-target"
        : { to: relativeLink(sourcePath, file), kind: "drop-anchor" };
    }

    const candidates = byBasename.get(basename(targetPath));

    if (candidates === undefined || candidates.length === 0) return "no-candidate";

    if (candidates.length > 1) return "ambiguous-candidate";

    return { to: relativeLink(sourcePath, candidates[0]!), kind: "repath" };
  };

  for (const link of input.links) {
    const decision = decide(link);

    if (Predicate.isString(decision)) {
      unfixable.push({ link, reason: decision });
      continue;
    }

    const sourcePath = repoPathForPage(input.docs, link.sourcePage, exists);

    if (sourcePath === null) {
      unfixable.push({ link, reason: "unresolvable-target" });
      continue;
    }

    const current = editsByPath.get(sourcePath) ?? input.files.readText(sourcePath);

    if (current === null) {
      // A source page the planner cannot read cannot be edited, and guessing at
      // its contents would corrupt a file nobody asked it to write.
      unfixable.push({ link, reason: "unresolvable-target" });
      continue;
    }

    const rewritten = rewriteLink(current, link.targetUrl, decision.to);

    if (rewritten === current) {
      // Nothing changed, so there is no fix to claim.
      unfixable.push({ link, reason: "unresolvable-target" });
      continue;
    }

    editsByPath.set(sourcePath, rewritten);
    fixes.push({ sourcePath, from: link.targetUrl, to: decision.to, kind: decision.kind });
  }

  return {
    edits: [...editsByPath].map(([path, content]) => ({ path, content })),
    fixes,
    unfixable,
  };
}

/** True when a link target points at another repository file rather than the web. */
export function isInternalTarget(target: string): boolean {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) && !target.startsWith("//");
}

/** True when an address names a file outside the docs root the monitor was pointed at. */
function isOutsideDocs(docs: SiteDocs, address: string): boolean {
  for (const candidate of pageCandidates(docs, address)) {
    if (!isWithinPath(docs.docsRoot, candidate)) return true;
  }

  return pageCandidates(docs, address).length === 0;
}

/** The relative path a link from `sourcePath` to `destination` would use. */
export function relativeLink(sourcePath: string, destination: string): string {
  // `relativeDir` already answers a clean relative path, so `..` segments it
  // produces are part of the answer and must not be resolved away.
  const directory = relativeDir(dirname(sourcePath), dirname(destination));
  const name = basename(destination);

  // `./page.md` and `/page.md` both read badly in a docs link; a bare name is what an author writes.
  return directory.length === 0 ? name : `${directory}/${name}`;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");

  return index < 0 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");

  return index < 0 ? path : path.slice(index + 1);
}

function relativeDir(from: string, to: string): string {
  const fromParts = from.split("/").filter((part) => part.length > 0);
  const toParts = to.split("/").filter((part) => part.length > 0);

  let shared = 0;

  while (
    shared < fromParts.length &&
    shared < toParts.length &&
    fromParts[shared] === toParts[shared]
  ) {
    shared += 1;
  }

  const up = fromParts.slice(shared).map(() => "..");
  const down = toParts.slice(shared);

  return [...up, ...down].join("/");
}

/**
 * Rewrites the link targets in `content` that exactly match `from`. Markdown
 * link destinations are matched in both `](target)` and `]: target` form, and a
 * bare target that appears outside a link is left alone so prose keeps its words.
 */
function rewriteLink(content: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(\\]\\()${escaped}(\\))`, "g");
  const reference = new RegExp(`(^\\s*\\[[^\\]]+\\]:\\s*)${escaped}(\\s*)$`, "gm");

  return content.replace(pattern, `$1${to}$2`).replace(reference, `$1${to}$2`);
}
