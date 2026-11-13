/**
 * One link-monitor run: walk the docs, judge every link, and hand back the
 * report a customer reads and an alert carries.
 *
 * The report is the contracts `LinkCheckReport`, the only shape a run produces.
 * It caps the links it lists so an alert stays small, and it refuses to arrive
 * at all when the walk judged nothing: a docs directory that moved is a failed
 * run, not a clean one.
 */
import { LINK_CHECK_REPORT_LIMIT, type LinkCheckReport } from "@isnadi/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import type { DocsSource } from "./DocsSource.ts";
import { makeLinkJudge } from "./LinkJudge.ts";
import { markdownLinks } from "./MarkdownLinks.ts";

/**
 * A crawl that judged no links says nothing about the docs: the walk found no
 * pages, or the directory is wrong. The contracts report refuses a zero count
 * for the same reason, but failing here names what it walked and what it found.
 */
export class LinkCheckFoundNoLinksError extends Schema.TaggedErrorClass<LinkCheckFoundNoLinksError>()(
  "LinkCheckFoundNoLinksError",
  { site: Schema.String, message: Schema.String },
) {}

/** Bounds a scheduled crawl so an unattended run cannot spin or fan out. */
export interface LinkCheckBudget {
  readonly maxPages: number;
  readonly maxLinks: number;
  readonly externalConcurrency: number;
  readonly requestTimeoutMs: number;
}

export const defaultLinkCheckBudget: LinkCheckBudget = {
  maxPages: 500,
  maxLinks: 2_000,
  externalConcurrency: 8,
  requestTimeoutMs: 10_000,
};

export interface RunLinkCheckInput {
  readonly source: DocsSource;
  readonly budget?: LinkCheckBudget;
}

/** One link found on one page, before anything is asked about it. */
interface LinkOnPage {
  readonly page: string;
  readonly target: string;
}

/**
 * A run needs the HTTP client whether the docs are local or on GitHub: local
 * docs still link to the web.
 */
export const runLinkCheck = (
  input: RunLinkCheckInput,
): Effect.Effect<LinkCheckReport, LinkCheckFoundNoLinksError, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const budget = input.budget ?? defaultLinkCheckBudget;
    const startedAt = DateTime.formatIso(yield* DateTime.now);
    const judge = yield* makeLinkJudge(input.source);

    const pages = yield* input.source
      .pages(budget.maxPages)
      .pipe(
        Effect.mapError(
          (error) =>
            new LinkCheckFoundNoLinksError({ site: input.source.site, message: error.message }),
        ),
      );

    const links = linksOnPages(pages, budget.maxLinks);

    if (links.length === 0) {
      return yield* new LinkCheckFoundNoLinksError({
        site: input.source.site,
        message: `No links were checked under '${input.source.site}': found ${pages.length} page(s) with no link to judge.`,
      });
    }

    const verdicts = yield* Effect.forEach(
      links,
      (link) => judge.judge(link.page, link.target, budget.requestTimeoutMs),
      { concurrency: budget.externalConcurrency },
    );

    const brokenLinks = verdicts.filter((verdict) => verdict !== null);
    const finishedAt = DateTime.formatIso(yield* DateTime.now);

    return {
      siteUrl: input.source.site,
      checkedCount: links.length,
      brokenCount: brokenLinks.length,
      brokenLinks: brokenLinks.slice(0, LINK_CHECK_REPORT_LIMIT),
      startedAt,
      finishedAt,
    } satisfies LinkCheckReport;
  });

/**
 * Every link the walk found, in page order, up to the run's link budget. A
 * docs page that nothing links to is still a page a reader reaches from search,
 * so every page is read, not just the reachable ones.
 */
function linksOnPages(
  pages: ReadonlyArray<{ readonly path: string; readonly markdown: string }>,
  maxLinks: number,
): ReadonlyArray<LinkOnPage> {
  const links: LinkOnPage[] = [];

  for (const page of pages) {
    for (const target of markdownLinks(page.markdown)) {
      if (links.length >= maxLinks) return links;

      links.push({ page: page.path, target });
    }
  }

  return links;
}
