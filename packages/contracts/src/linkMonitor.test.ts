import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { isCleanLinkCheck, LINK_CHECK_REPORT_LIMIT, LinkCheckReport } from "./linkMonitor.ts";

const decodeSyncLinkCheckReport = Schema.decodeUnknownSync(LinkCheckReport);

const startedAt = "2026-11-13T08:00:00.000Z";

const finishedAt = "2026-11-13T08:01:00.000Z";

const cleanReport = {
  siteUrl: "https://docs.example.com",
  checkedCount: 214,
  brokenCount: 0,
  brokenLinks: [],
  startedAt,
  finishedAt,
} as const;

const brokenLink = {
  sourcePage: "https://docs.example.com/start",
  targetUrl: "https://docs.example.com/gone",
  status: 404,
  reason: null,
} as const;

describe("link check report contracts", () => {
  it("decodes a clean run", () => {
    expect(decodeSyncLinkCheckReport(cleanReport)).toEqual(cleanReport);
  });

  it("keeps the reported links apart from the true count", () => {
    const report = decodeSyncLinkCheckReport({
      ...cleanReport,
      brokenCount: 87,
      brokenLinks: [brokenLink],
    });

    expect(report.brokenCount).toBe(87);
    expect(report.brokenLinks).toHaveLength(1);
  });

  it("carries a link that never answered", () => {
    expect(
      decodeSyncLinkCheckReport({
        ...cleanReport,
        brokenCount: 1,
        brokenLinks: [{ ...brokenLink, status: null, reason: "connection refused" }],
      }).brokenLinks[0],
    ).toEqual({
      sourcePage: "https://docs.example.com/start",
      targetUrl: "https://docs.example.com/gone",
      status: null,
      reason: "connection refused",
    });
  });

  it("refuses a run that checked nothing", () => {
    expect(() => decodeSyncLinkCheckReport({ ...cleanReport, checkedCount: 0 })).toThrow();
  });

  it("refuses more broken links than an alert carries", () => {
    const brokenLinks = Array.from({ length: LINK_CHECK_REPORT_LIMIT + 1 }, () => brokenLink);

    expect(() =>
      decodeSyncLinkCheckReport({ ...cleanReport, brokenCount: 51, brokenLinks }),
    ).toThrow();
  });

  it("accepts exactly the report limit", () => {
    const brokenLinks = Array.from({ length: LINK_CHECK_REPORT_LIMIT }, () => brokenLink);

    expect(
      decodeSyncLinkCheckReport({ ...cleanReport, brokenCount: 51, brokenLinks }).brokenLinks,
    ).toHaveLength(LINK_CHECK_REPORT_LIMIT);
  });

  it("trims and refuses blank strings", () => {
    expect(
      decodeSyncLinkCheckReport({ ...cleanReport, siteUrl: "  https://docs.example.com  " })
        .siteUrl,
    ).toBe("https://docs.example.com");

    expect(() => decodeSyncLinkCheckReport({ ...cleanReport, siteUrl: "   " })).toThrow();
    expect(() =>
      decodeSyncLinkCheckReport({
        ...cleanReport,
        brokenCount: 1,
        brokenLinks: [{ ...brokenLink, targetUrl: " " }],
      }),
    ).toThrow();
  });

  it("is clean only when the run broke nothing", () => {
    expect(isCleanLinkCheck(decodeSyncLinkCheckReport(cleanReport))).toBe(true);
    expect(
      isCleanLinkCheck(
        decodeSyncLinkCheckReport({ ...cleanReport, brokenCount: 1, brokenLinks: [brokenLink] }),
      ),
    ).toBe(false);
  });
});
