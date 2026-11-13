import type { LinkCheckBrokenLink } from "@isnadi/contracts";
import { assert, it } from "@effect/vitest";

import { planLinkFixes, type FixPlannerFiles } from "./fixPlan.ts";
import { linkKey, type SiteDocs } from "./sitePages.ts";

const SITE: SiteDocs = { siteUrl: "https://docs.invalid", docsRoot: "docs" };

/** A docs tree that answers exactly what the planner asks, so a case reads as one line. */
function files(entries: Record<string, string>): FixPlannerFiles {
  return {
    listDocsFiles: () => Object.keys(entries),
    readText: (path: string) => entries[path] ?? null,
  };
}

/** One broken link as the crawl reports it: the page URL, and the href as written. */
function link(
  sourcePage: string,
  targetUrl: string,
  status: number | null = 404,
): LinkCheckBrokenLink {
  return { sourcePage, targetUrl, status, reason: status === null ? "timeout" : null };
}

function plan(input: {
  readonly links: ReadonlyArray<LinkCheckBrokenLink>;
  readonly entries: Record<string, string>;
  readonly redirects?: ReadonlyArray<[LinkCheckBrokenLink, string]>;
}) {
  return planLinkFixes({
    docs: SITE,
    links: input.links,
    redirects: new Map(
      (input.redirects ?? []).map(([entry, location]) => [linkKey(entry), location]),
    ),
    files: files(input.entries),
  });
}

it("retargets a link whose old address redirects", () => {
  const broken = link("https://docs.invalid/a", "old.md", 301);

  const result = plan({
    links: [broken],
    redirects: [[broken, "https://docs.invalid/new"]],
    entries: {
      "docs/a.md": "See [the guide](old.md) for details.",
      "docs/new.md": "# New",
    },
  });

  assert.deepEqual(
    result.fixes.map((fix) => [fix.from, fix.to, fix.kind]),
    [["old.md", "new.md", "redirect"]],
  );
  assert.equal(result.edits[0]?.content, "See [the guide](new.md) for details.");
  assert.deepEqual(result.unfixable, []);
});

it("relativizes a redirect that lands in another folder", () => {
  const broken = link("https://docs.invalid/guide/a", "old.md", 302);

  const result = plan({
    links: [broken],
    redirects: [[broken, "https://docs.invalid/internals/new"]],
    entries: {
      "docs/guide/a.md": "[x](old.md)",
      "docs/internals/new.md": "# New",
    },
  });

  assert.equal(result.edits[0]?.content, "[x](../internals/new.md)");
});

it("refuses a redirect that leaves the docs site", () => {
  const broken = link("https://docs.invalid/a", "old.md", 301);

  const result = plan({
    links: [broken],
    redirects: [[broken, "https://published.invalid/new"]],
    entries: { "docs/a.md": "[x](old.md)" },
  });

  assert.deepEqual(result.edits, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["outside-docs"],
  );
});

it("reports a redirect into a page that is not in the docs", () => {
  const broken = link("https://docs.invalid/a", "old.md", 301);

  const result = plan({
    links: [broken],
    redirects: [[broken, "https://docs.invalid/gone"]],
    entries: { "docs/a.md": "[x](old.md)" },
  });

  assert.deepEqual(result.edits, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["no-candidate"],
  );
});

it("repaths a moved page by its basename when exactly one candidate exists", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "old/page.md")],
    entries: {
      "docs/a.md": "[page](old/page.md)",
      "docs/guide/page.md": "# Page",
    },
  });

  assert.deepEqual(
    result.fixes.map((fix) => [fix.to, fix.kind]),
    [["guide/page.md", "repath"]],
  );
  assert.equal(result.edits[0]?.content, "[page](guide/page.md)");
});

it("refuses to repath when two docs files share the basename", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "old/page.md")],
    entries: {
      "docs/a.md": "[page](old/page.md)",
      "docs/guide/page.md": "# One",
      "docs/internals/page.md": "# Two",
    },
  });

  assert.deepEqual(result.fixes, []);
  assert.deepEqual(result.edits, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["ambiguous-candidate"],
  );
});

it("drops a dead anchor and links the page that still exists", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "b.md#gone")],
    entries: {
      "docs/a.md": "[b](b.md#gone)",
      "docs/b.md": "# B",
    },
  });

  assert.deepEqual(
    result.fixes.map((fix) => [fix.to, fix.kind]),
    [["b.md", "drop-anchor"]],
  );
  assert.equal(result.edits[0]?.content, "[b](b.md)");
});

it("reads a directory URL as its index page", () => {
  const result = plan({
    links: [link("https://docs.invalid/guide/", "setup.md#gone")],
    entries: {
      "docs/guide/index.md": "[setup](setup.md#gone)",
      "docs/guide/setup.md": "# Setup",
    },
  });

  assert.equal(result.edits[0]?.path, "docs/guide/index.md");
  assert.deepEqual(
    result.fixes.map((fix) => fix.to),
    ["setup.md"],
  );
});

it("reports an external URL instead of rewriting it", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "https://example.invalid/page", null)],
    entries: { "docs/a.md": "[x](https://example.invalid/page)" },
  });

  assert.deepEqual(result.fixes, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["external"],
  );
});

it("refuses a bare anchor, because no heading can be proven to be the right one", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "#gone")],
    entries: { "docs/a.md": "[x](#gone)" },
  });

  assert.deepEqual(result.edits, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["unresolvable-target"],
  );
});

it("reports a broken link whose page was not found in the docs", () => {
  const result = plan({
    links: [link("https://docs.invalid/elsewhere/a", "b.md")],
    entries: { "docs/a.md": "[b](b.md)", "docs/b.md": "# B" },
  });

  assert.deepEqual(result.edits, []);
  assert.deepEqual(
    result.unfixable.map((entry) => entry.reason),
    ["unresolvable-target"],
  );
});

it("leaves prose that merely mentions the target alone", () => {
  const result = plan({
    links: [link("https://docs.invalid/a", "b.md#gone")],
    entries: {
      "docs/a.md": "The old b.md#gone path was retired.\n\n[b](b.md#gone)\n",
      "docs/b.md": "# B",
    },
  });

  assert.equal(result.edits[0]?.content, "The old b.md#gone path was retired.\n\n[b](b.md)\n");
  assert.deepEqual(
    result.fixes.map((fix) => fix.kind),
    ["drop-anchor"],
  );
});

it("extends one edit when a page has several broken links", () => {
  const result = plan({
    links: [
      link("https://docs.invalid/a", "one.md#gone"),
      link("https://docs.invalid/a", "two.md#gone"),
    ],
    entries: {
      "docs/a.md": "[one](one.md#gone) and [two](two.md#gone)",
      "docs/one.md": "# One",
      "docs/two.md": "# Two",
    },
  });

  assert.equal(result.edits.length, 1);
  assert.equal(result.edits[0]?.content, "[one](one.md) and [two](two.md)");
  assert.equal(result.fixes.length, 2);
});

it("plans nothing when there are no broken links", () => {
  const result = plan({ links: [], entries: { "docs/a.md": "# A" } });

  assert.deepEqual(result, { edits: [], fixes: [], unfixable: [] });
});
