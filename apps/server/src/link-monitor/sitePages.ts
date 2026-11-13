import type { LinkCheckBrokenLink } from "@isnadi/contracts";

/**
 * A crawled docs tree: the address the site answers at, and the repo folder
 * that backs it. A report names pages and links the way the web does (URLs and
 * hrefs), while an edit needs the file they live in, so every page lookup goes
 * through this one mapping instead of being re-guessed per decision.
 */
export interface SiteDocs {
  /** What the crawl walked: a site base URL, or the docs path of a local crawl. */
  readonly siteUrl: string;
  /** Repo-relative docs root. Nothing outside it is readable or editable. */
  readonly docsRoot: string;
}

/**
 * A page that is not a real file (a directory listing, a route) can still be
 * served by one of these; they are tried in this order and only a file that
 * exists is ever used.
 */
const PAGE_EXTENSIONS = [".md", ".mdx", ".markdown"];

/** The key one broken link is looked up by, both in a report and in redirect answers. */
export function linkKey(link: LinkCheckBrokenLink): string {
  return `${link.sourcePage}\u0000${link.targetUrl}`;
}

/**
 * Every repo-relative file `page` could be, best first: the page as written,
 * then the filename it would get, then its folder's index. A candidate that is
 * not in the tree is dropped by the caller, never by this function.
 */
export function pageCandidates(site: SiteDocs, page: string): ReadonlyArray<string> {
  const remainder = pageRemainder(site, page);

  if (remainder === null) return [];

  const clean = trimSlashes(remainder);
  const joined = clean.length === 0 ? site.docsRoot : `${site.docsRoot}/${clean}`;

  if (clean.length === 0) {
    return [`${joined}/index.md`, `${joined}/README.md`];
  }

  if (PAGE_EXTENSIONS.some((extension) => clean.endsWith(extension))) return [joined];

  return [joined, `${joined}.md`, `${joined}/index.md`, `${joined}/README.md`];
}

/**
 * The part of `page` that names a file below the site's root, or null when the
 * page is not this site's (another origin, a route above the root). A page that
 * is not a URL is taken as repo-relative or docs-relative, which is what a local
 * crawl of the docs folder reports.
 */
function pageRemainder(site: SiteDocs, page: string): string | null {
  const pageUrl = asUrl(page);

  if (pageUrl === null) {
    const path = trimSlashes(safeDecode(page.split("#")[0] ?? ""));

    if (path === site.docsRoot) return "";

    if (path.startsWith(`${site.docsRoot}/`)) return path.slice(site.docsRoot.length + 1);

    return path;
  }

  const base = asUrl(site.siteUrl);

  // A URL page under a local crawl has no origin to be read against.
  if (base === null) return null;

  if (pageUrl.origin !== base.origin) return null;

  const basePath = trimTrailingSlash(base.pathname);

  if (!isWithinPath(basePath, pageUrl.pathname)) return null;

  return safeDecode(pageUrl.pathname.slice(basePath.length));
}

/** An href cut at its fragment: the part that names a page, and the part that names a section. */
export interface SplitAddress {
  readonly path: string;
  readonly anchor: string | null;
}

/** The href without its fragment, and the fragment without its `#`, if either exists. */
export function splitAddress(href: string): SplitAddress {
  const hash = href.indexOf("#");

  if (hash < 0) return { path: href, anchor: null };

  const anchor = href.slice(hash + 1);

  return { path: href.slice(0, hash), anchor: anchor.length > 0 ? anchor : null };
}

/**
 * Resolves one href against the page it was written on, the way a browser does:
 * a path with no scheme is relative to the page, an absolute one stands alone.
 */
export function resolvePageAddress(page: string, target: string): string {
  const pageUrl = asUrl(page);

  if (pageUrl !== null) return new URL(target, pageUrl).toString();

  return joinPath(page.split("#")[0] ?? "", target);
}

/** The repo-relative file a page address maps to, or null when no candidate exists. */
export function repoPathForPage(
  site: SiteDocs,
  page: string,
  exists: (repoRelativePath: string) => boolean,
): string | null {
  for (const candidate of pageCandidates(site, page)) {
    if (exists(candidate)) return candidate;
  }

  return null;
}

/**
 * True when `candidate` is `root` or below it. Both are read as paths, so `.`
 * and `..` are resolved first: a candidate that climbs out with `..` is outside
 * even when its text starts with the root, and an empty root (a repository or an
 * origin's `/`) contains everything.
 */
export function isWithinPath(root: string, candidate: string): boolean {
  const rootParts = pathSegments(root);
  const candidateParts = pathSegments(candidate);

  if (candidateParts.length < rootParts.length) return false;

  return rootParts.every((part, index) => candidateParts[index] === part);
}

/** The meaningful segments of a path, with `.`/`..` resolved and slashes dropped. */
function pathSegments(path: string): ReadonlyArray<string> {
  const parts: string[] = [];

  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts;
}

/** Joins `target` onto `base` the way a browser resolves a relative href. */
function joinPath(base: string, target: string): string {
  const parts: string[] = [];

  for (const part of `${base}/${target}`.replaceAll("\\", "/").split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return parts.join("/");
}

function asUrl(value: string): URL | null {
  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}
