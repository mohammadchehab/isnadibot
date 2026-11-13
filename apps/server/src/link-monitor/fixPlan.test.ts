import { assert, it } from "@effect/vitest";

import { planLinkFixes, type FixPlannerFiles } from "./fixPlan.ts";

const DOCS_ROOT = "docs";

/** A docs tree that answers exactly what the planner asks, so a case reads as one line. */
function files(entries: Record<string, string>): FixPlannerFiles {
  return {
    listDocsFiles: () => Object.keys(entries),
    readText: (path: string) => entries[path] ?? null,
  };
}

it("retargets a link whose old address redirects", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [
      { sourcePath: "docs/a.md", target: "old.md", reason: "redirect", redirectTo: "docs/new.md" },
    ],
    files: files({
      "docs/a.md": "See [the guide](old.md) for details.",
      "docs/new.md": "# New",
    }),
  });

  assert.deepEqual(
    plan.fixes.map((fix) => [fix.from, fix.to, fix.kind]),
    [["old.md", "new.md", "redirect"]],
  );
  assert.equal(plan.edits[0]?.content, "See [the guide](new.md) for details.");
  assert.deepEqual(plan.unfixable, []);
});

it("repaths a moved page by its basename when exactly one candidate exists", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "old/page.md", reason: "missing-file" }],
    files: files({
      "docs/a.md": "[page](old/page.md)",
      "docs/guide/page.md": "# Page",
    }),
  });

  assert.deepEqual(
    plan.fixes.map((fix) => [fix.to, fix.kind]),
    [["guide/page.md", "repath"]],
  );
  assert.equal(plan.edits[0]?.content, "[page](guide/page.md)");
});

it("refuses to repath when two docs files share the basename", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "old/page.md", reason: "missing-file" }],
    files: files({
      "docs/a.md": "[page](old/page.md)",
      "docs/guide/page.md": "# One",
      "docs/internals/page.md": "# Two",
    }),
  });

  assert.deepEqual(plan.fixes, []);
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(
    plan.unfixable.map((entry) => entry.reason),
    ["ambiguous-candidate"],
  );
});

it("drops a dead anchor and links the page that still exists", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "b.md#gone", reason: "missing-anchor" }],
    files: files({
      "docs/a.md": "[b](b.md#gone)",
      "docs/b.md": "# B",
    }),
  });

  assert.deepEqual(
    plan.fixes.map((fix) => [fix.to, fix.kind]),
    [["b.md", "drop-anchor"]],
  );
  assert.equal(plan.edits[0]?.content, "[b](b.md)");
});

it("reports an external URL instead of rewriting it", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "https://example.invalid/page", reason: "timeout" }],
    files: files({ "docs/a.md": "[x](https://example.invalid/page)" }),
  });

  assert.deepEqual(plan.fixes, []);
  assert.deepEqual(
    plan.unfixable.map((entry) => entry.reason),
    ["external"],
  );
});

it("refuses a target that climbs out of the docs root", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "../../etc/passwd", reason: "missing-file" }],
    files: files({ "docs/a.md": "[x](../../etc/passwd)" }),
  });

  assert.deepEqual(plan.edits, []);
  assert.deepEqual(
    plan.unfixable.map((entry) => entry.reason),
    ["outside-docs"],
  );
});

it("refuses a redirect that lands outside the docs root", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [
      {
        sourcePath: "docs/a.md",
        target: "old.md",
        reason: "redirect",
        redirectTo: "../../elsewhere.md",
      },
    ],
    files: files({ "docs/a.md": "[x](old.md)" }),
  });

  assert.deepEqual(plan.edits, []);
  assert.deepEqual(
    plan.unfixable.map((entry) => entry.reason),
    ["outside-docs"],
  );
});

it("reports a redirect whose destination page is not in the docs", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [
      {
        sourcePath: "docs/a.md",
        target: "old.md",
        reason: "redirect",
        redirectTo: "https://published.invalid/new.md",
      },
    ],
    files: files({ "docs/a.md": "[x](old.md)" }),
  });

  assert.deepEqual(plan.edits, []);
  assert.deepEqual(
    plan.unfixable.map((entry) => entry.reason),
    ["outside-docs"],
  );
});

it("leaves prose that merely mentions the target alone", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [{ sourcePath: "docs/a.md", target: "b.md#gone", reason: "missing-anchor" }],
    files: files({
      "docs/a.md": "The old b.md#gone path was retired.\n\n[b](b.md#gone)\n",
      "docs/b.md": "# B",
    }),
  });

  assert.equal(plan.edits[0]?.content, "The old b.md#gone path was retired.\n\n[b](b.md)\n");
  assert.deepEqual(
    plan.fixes.map((fix) => fix.kind),
    ["drop-anchor"],
  );
});

it("extends one edit when a page has several broken links", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [
      { sourcePath: "docs/a.md", target: "one.md#gone", reason: "missing-anchor" },
      { sourcePath: "docs/a.md", target: "two.md#gone", reason: "missing-anchor" },
    ],
    files: files({
      "docs/a.md": "[one](one.md#gone) and [two](two.md#gone)",
      "docs/one.md": "# One",
      "docs/two.md": "# Two",
    }),
  });

  assert.equal(plan.edits.length, 1);
  assert.equal(plan.edits[0]?.content, "[one](one.md) and [two](two.md)");
  assert.equal(plan.fixes.length, 2);
});

it("plans nothing when there are no broken links", () => {
  const plan = planLinkFixes({
    docsRoot: DOCS_ROOT,
    links: [],
    files: files({ "docs/a.md": "# A" }),
  });

  assert.deepEqual(plan, { edits: [], fixes: [], unfixable: [] });
});
