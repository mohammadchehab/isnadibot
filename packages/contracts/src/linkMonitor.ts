import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The tool a link-check run calls to hand its result to Isnadi. */
export const ISNADI_REPORT_LINK_CHECK_TOOL_NAME = "isnadi_report_link_check";

/**
 * The most broken links one report carries. A run reports the true total in
 * `brokenCount` and the first `LINK_CHECK_REPORT_LIMIT` in `brokenLinks`, so an
 * alert payload stays small however many links a site has rotted.
 */
export const LINK_CHECK_REPORT_LIMIT = 50;

/** One link that did not resolve, and the page it was found on. */
export const LinkCheckBrokenLink = Schema.Struct({
  /** The page the link sits on. */
  sourcePage: TrimmedNonEmptyString,
  /** The link itself, as written on that page. */
  targetUrl: TrimmedNonEmptyString,
  /** The HTTP status the link answered with, or null when it never answered. */
  status: Schema.NullOr(Schema.Int),
  /** Why there is no status, or what was wrong with the answer, when known. */
  reason: Schema.NullOr(TrimmedNonEmptyString),
});

export type LinkCheckBrokenLink = typeof LinkCheckBrokenLink.Type;

/** A run that finished its work found something to check. Zero is a failed run. */
const PositiveCheckedCount = Schema.Int.check(Schema.isGreaterThan(0));

/**
 * What one link-monitor run found. A run that checked nothing has no report to
 * make: `checkedCount` starts at one so a crashed crawl, an unreachable site or
 * a walk that resolved no links is refused instead of arriving as a clean run.
 */
export const LinkCheckReport = Schema.Struct({
  /** What was crawled: a site URL, or the docs path a local crawl walked. */
  siteUrl: TrimmedNonEmptyString,
  checkedCount: PositiveCheckedCount,
  /** Every broken link the run found, including those past the reported limit. */
  brokenCount: NonNegativeInt,
  /** The broken links the run reports, at most LINK_CHECK_REPORT_LIMIT of them. */
  brokenLinks: Schema.Array(LinkCheckBrokenLink).check(Schema.isMaxLength(LINK_CHECK_REPORT_LIMIT)),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime,
});

export type LinkCheckReport = typeof LinkCheckReport.Type;

/** True when a run checked links and none of them were broken. */
export function isCleanLinkCheck(report: LinkCheckReport): boolean {
  return report.brokenCount === 0;
}
