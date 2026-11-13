/**
 * `isnadi link-monitor` — crawl the docs and write the broken-link report.
 *
 * One command, run by hand or on a schedule: it takes a docs directory in this
 * checkout or a GitHub link a customer would paste, judges every link, and
 * writes the report where the rest of the monitor reads it. The exit code is 1
 * when a link is broken, so a scheduled run can tell the two outcomes apart
 * without parsing the file.
 */
import { isCleanLinkCheck, type LinkCheckReport } from "@isnadi/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Command, Flag } from "effect/unstable/cli";

import { docsSourceFromTarget } from "../link-monitor/DocsSource.ts";
import { runLinkCheck } from "../link-monitor/RunLinkCheck.ts";

/** How many broken links the summary line lists before it says "and n more". */
const SUMMARY_LIMIT = 5;

export const linkMonitorCommand = Command.make(
  "link-monitor",
  {
    docs: Flag.string("docs").pipe(
      Flag.withDescription(
        "Docs directory in this checkout, or a GitHub link such as https://github.com/owner/repo/tree/main/docs.",
      ),
      Flag.withDefault("docs"),
    ),
    root: Flag.string("root").pipe(
      Flag.withDescription("Checkout the docs directory is read from."),
      Flag.withDefault("."),
    ),
    out: Flag.string("out").pipe(
      Flag.withDescription(
        "Where to write the report. Defaults to <root>/.isnadi/link-check-report.json.",
      ),
      Flag.optional,
    ),
  },
  (flags) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const source = yield* docsSourceFromTarget(flags.docs, { projectRoot: flags.root });
      const report = yield* runLinkCheck({ source });
      const outputPath = Option.getOrElse(flags.out, () =>
        path.join(flags.root, ".isnadi", "link-check-report.json"),
      );

      yield* fileSystem.makeDirectory(path.dirname(outputPath), { recursive: true });
      yield* fileSystem.writeFileString(outputPath, `${JSON.stringify(report, null, 2)}\n`);
      yield* Console.log(renderReport(report, outputPath));

      if (!isCleanLinkCheck(report)) {
        yield* Effect.sync(() => {
          process.exitCode = 1;
        });
      }
    }),
).pipe(Command.withDescription("Crawl the docs and write the broken-link report."));

/** What a person reads after a run: the count, then the first few broken links. */
export function renderReport(report: LinkCheckReport, outputPath: string): string {
  const lines = [
    `${report.siteUrl} — ${report.checkedCount} links checked, ${report.brokenCount} broken`,
    ...report.brokenLinks
      .slice(0, SUMMARY_LIMIT)
      .map((link) => `  ${link.sourcePage} → ${link.targetUrl} (${link.reason ?? "unknown"})`),
    report.brokenCount > SUMMARY_LIMIT
      ? `  and ${report.brokenCount - SUMMARY_LIMIT} more in the report`
      : "",
    `report: ${outputPath}`,
  ];

  return lines.filter((line) => line !== "").join("\n");
}
