import * as Predicate from "effect/Predicate";

import { isInternalTarget, splitAnchor, type BrokenLink } from "./brokenLinkReport.ts";

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
  readonly link: BrokenLink;
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

/** True when `candidate` is `root` or below it, with no `..` escape. */
export function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = normalize(root);
  const normalizedCandidate = normalize(candidate);

  return (
    normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}

function normalize(path: string): string {
  const parts: string[] = [];

  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}

/** Resolves `target` the way a browser would, against the page that links it. */
export function resolveTarget(sourcePath: string, target: string): string {
  if (target.startsWith("/")) return normalize(target);

  if (target.startsWith("./") || target.startsWith("../")) {
    return normalize(`${dirname(sourcePath)}/${target}`);
  }

  // A bare `page.md#x` is ambiguous to a browser and common to a mistake: read it
  // as relative to the linking page, which is what the author meant.
  return normalize(`${dirname(sourcePath)}/${target}`);
}

/** The relative path a link from `sourcePath` to `destination` would use. */
export function relativeLink(sourcePath: string, destination: string): string {
  const directory = normalize(relativeDir(dirname(sourcePath), dirname(destination)));
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
 * Plans the edits that repair what can be repaired and names the rest. Pure: it
 * writes nothing and runs no command, so a plan can be inspected, tested, and
 * refused before any branch exists.
 *
 * A rewrite only ever happens for a link that points inside the docs root, and
 * only into a file that exists there. Everything else is reported, which keeps
 * the fixer from inventing a destination it cannot verify.
 */
export function planLinkFixes(input: {
  readonly docsRoot: string;
  readonly links: ReadonlyArray<BrokenLink>;
  readonly files: FixPlannerFiles;
}): LinkFixPlan {
  const docsFiles = input.files.listDocsFiles();
  const byBasename = new Map<string, string[]>();

  for (const file of docsFiles) {
    const name = basename(file);
    const existing = byBasename.get(name);

    if (existing === undefined) byBasename.set(name, [file]);
    else existing.push(file);
  }

  const fixes: Fix[] = [];
  const unfixable: Unfixable[] = [];
  // One entry per source file, so a second fix in the same file extends the
  // content rather than writing over the first.
  const editsByPath = new Map<string, string>();

  const decide = (link: BrokenLink): { to: string; kind: FixKind } | UnfixableReason => {
    const { path: pagePath, anchor } = splitAnchor(link.target);

    if (!isInternalTarget(link.target)) return "external";

    if (link.redirectTo !== undefined) {
      const redirect = splitAnchor(link.redirectTo);
      // The crawler reports where the redirect landed as a repo-relative path, because
      // only it knows how the site's URLs map onto files.
      const resolved = normalize(redirect.path);

      if (!isInternalTarget(link.redirectTo) || !isWithin(input.docsRoot, resolved)) {
        return "outside-docs";
      }

      // The redirect names where the page went; write it the way a link from this
      // page has to be written, not the way the server wrote it.
      if (input.files.readText(resolved) === null) return "no-candidate";

      const suffix = redirect.anchor === null ? "" : `#${redirect.anchor}`;

      return { to: `${relativeTo(link.sourcePath, resolved)}${suffix}`, kind: "redirect" };
    }

    if (pagePath.length === 0) {
      // A bare `#anchor` links into the page it sits on, so there is no file to repair.
      return anchor === null ? "unresolvable-target" : { to: `#${anchor}`, kind: "drop-anchor" };
    }

    const resolved = resolveTarget(link.sourcePath, pagePath);

    if (!isWithin(input.docsRoot, resolved)) return "outside-docs";

    const text = input.files.readText(resolved);

    if (text !== null) {
      // The file is there, so this was only ever about the fragment.
      return anchor === null
        ? "unresolvable-target"
        : { to: relativeTo(link.sourcePath, resolved), kind: "drop-anchor" };
    }

    const candidates = byBasename.get(basename(pagePath)) ?? [];

    if (candidates.length === 0) return "no-candidate";

    if (candidates.length > 1) return "ambiguous-candidate";

    return { to: relativeTo(link.sourcePath, candidates[0]!), kind: "repath" };
  };

  for (const link of input.links) {
    const decision = decide(link);

    if (Predicate.isString(decision)) {
      unfixable.push({ link, reason: decision });
      continue;
    }

    const current = editsByPath.get(link.sourcePath) ?? input.files.readText(link.sourcePath);

    if (current === null) {
      // A source page the planner cannot read cannot be edited, and guessing at
      // its contents would corrupt a file nobody asked it to write.
      unfixable.push({ link, reason: "unresolvable-target" });
      continue;
    }

    const rewritten = rewriteLink(current, link.target, decision.to);

    if (rewritten === current) {
      // Nothing changed, so there is no fix to claim.
      unfixable.push({ link, reason: "unresolvable-target" });
      continue;
    }

    editsByPath.set(link.sourcePath, rewritten);
    fixes.push({
      sourcePath: link.sourcePath,
      from: link.target,
      to: decision.to,
      kind: decision.kind,
    });
  }

  return {
    edits: [...editsByPath].map(([path, content]) => ({ path, content })),
    fixes,
    unfixable,
  };
}

function relativeTo(sourcePath: string, destination: string): string {
  return relativeLink(sourcePath, destination).replace(/^\.\//, "");
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
