import { TrimmedNonEmptyString } from "@isnadi/contracts";
import * as Schema from "effect/Schema";

/**
 * The crawl report the link monitor hands to the fixer. Written by the crawl
 * half of the monitor and read back as JSON, so every field is parsed on the
 * way in rather than trusted: a report is a file on disk that a run produced,
 * and a malformed one must fail loudly instead of steering an edit.
 */
export const BrokenLinkReason = Schema.Literals([
  "http-error",
  "missing-file",
  "missing-anchor",
  "timeout",
  "redirect",
]);

export type BrokenLinkReason = typeof BrokenLinkReason.Type;

/**
 * One link that did not resolve. `sourcePath` is repo-relative. `target` is the
 * href exactly as the source page writes it, because that is the string the fixer
 * has to find in the file. `redirectTo` is repo-relative: only the crawl knows
 * which page a site URL landed on.
 */
export const BrokenLink = Schema.Struct({
  sourcePath: TrimmedNonEmptyString,
  target: TrimmedNonEmptyString,
  status: Schema.optional(Schema.Int),
  reason: BrokenLinkReason,
  redirectTo: Schema.optional(TrimmedNonEmptyString),
});

export type BrokenLink = typeof BrokenLink.Type;

export const CrawledPage = Schema.Struct({
  path: TrimmedNonEmptyString,
  status: Schema.Int,
});

export type CrawledPage = typeof CrawledPage.Type;

/** The report TASK-200's crawl writes and this half consumes. */
export const BrokenLinkReport = Schema.Struct({
  site: TrimmedNonEmptyString,
  generatedAt: TrimmedNonEmptyString,
  pages: Schema.Array(CrawledPage),
  broken: Schema.Array(BrokenLink),
});

export type BrokenLinkReport = typeof BrokenLinkReport.Type;

/** Parses a report file's contents, failing on anything the schema does not allow. */
export const decodeBrokenLinkReport = Schema.decodeUnknownSync(BrokenLinkReport);

/** True when a link target points at another repository file rather than the web. */
export function isInternalTarget(target: string): boolean {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target) && !target.startsWith("//");
}

/** A link target taken apart: the page it names and the fragment it asks for, if any. */
export interface LinkTarget {
  readonly path: string;
  readonly anchor: string | null;
}

/** Splits `page.md#section` into its path and its anchor without its `#`. */
export function splitAnchor(target: string): LinkTarget {
  const hash = target.indexOf("#");

  if (hash < 0) {
    return { path: target, anchor: null };
  }

  const anchor = target.slice(hash + 1);

  return { path: target.slice(0, hash), anchor: anchor.length > 0 ? anchor : null };
}
