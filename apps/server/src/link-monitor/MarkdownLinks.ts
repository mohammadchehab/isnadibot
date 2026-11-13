/**
 * Every link a rendered docs page would offer a reader.
 *
 * A checker that reads prose instead of markdown reports links that a reader
 * never sees: an example inside a fence is sample code, not a link. So fences,
 * inline code and HTML comments are removed before matching, and image sources
 * are kept because a broken image is a broken link too.
 */
export function markdownLinks(markdown: string): ReadonlyArray<string> {
  const text = stripNonRenderedMarkdown(markdown);
  const links: string[] = [];

  for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s()]+)(?:\s+"[^"]*")?\s*\)/g)) {
    const target = match[1];

    if (target) links.push(unwrapAngleBrackets(target));
  }

  for (const match of text.matchAll(/^ {0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/gm)) {
    const target = match[1];

    if (target) links.push(unwrapAngleBrackets(target));
  }

  return links;
}

/** ATX headings a link can point at, following GitHub's anchor rules. */
export function headingAnchors(markdown: string): ReadonlySet<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();

  for (const match of stripNonRenderedMarkdown(markdown).matchAll(
    /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/gm,
  )) {
    const base = anchorSlug(match[2] ?? "");
    const seen = occurrences.get(base) ?? 0;

    occurrences.set(base, seen + 1);
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
  }

  return anchors;
}

/**
 * GitHub keeps letters, digits, spaces, hyphens and underscores, lowercases
 * the rest away, then turns each space into a hyphen. Punctuation such as `.`
 * or `:` disappears and an underscore survives, which is why
 * `docs/user/bots.md#isnadi_run_link_check` works.
 */
export function anchorSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[`*~[\]()]/g, "")
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .replaceAll(/\s/g, "-");
}

function stripNonRenderedMarkdown(markdown: string): string {
  return markdown
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm, "")
    .replaceAll(/`[^`\n]*`/g, "");
}

function unwrapAngleBrackets(target: string): string {
  return target.startsWith("<") && target.endsWith(">") ? target.slice(1, -1) : target;
}
