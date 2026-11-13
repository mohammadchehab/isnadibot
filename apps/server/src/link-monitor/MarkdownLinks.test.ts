import { assert, it } from "@effect/vitest";

import { anchorSlug, headingAnchors, markdownLinks } from "./MarkdownLinks.ts";

it("reads inline links, images and reference definitions", () => {
  const markdown = [
    "See [the guide](./guide.md) and [the API](./api.md#runs).",
    "![diagram](./img/flow.png)",
    "[ref]: ./reference.md",
  ].join("\n");

  assert.deepEqual(markdownLinks(markdown), [
    "./guide.md",
    "./api.md#runs",
    "./img/flow.png",
    "./reference.md",
  ]);
});

it("ignores links a reader never sees", () => {
  const markdown = [
    "Real [link](./real.md).",
    "```md",
    "[in a fence](./fenced.md)",
    "```",
    "Inline `[in code](./inline.md)` is sample text.",
    "<!-- [commented out](./comment.md) -->",
  ].join("\n");

  assert.deepEqual(markdownLinks(markdown), ["./real.md"]);
});

it("keeps an angled target and drops its wrapping brackets", () => {
  assert.deepEqual(markdownLinks("[spaced](<./has space.md>)"), ["./has space.md"]);
});

it("slugs headings the way GitHub does", () => {
  assert.equal(anchorSlug("Run a Routine"), "run-a-routine");
  assert.equal(anchorSlug("`isnadi_run_link_check` tool"), "isnadi_run_link_check-tool");
  assert.equal(anchorSlug("What's new? (v2)"), "whats-new-v2");
});

it("numbers repeated heading slugs so later ones stay reachable", () => {
  const anchors = headingAnchors("# Setup\n## Setup\n## Setup\n");

  assert.isTrue(anchors.has("setup"));
  assert.isTrue(anchors.has("setup-1"));
  assert.isTrue(anchors.has("setup-2"));
});
