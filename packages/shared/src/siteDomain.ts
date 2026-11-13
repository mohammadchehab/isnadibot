import { getDomain } from "tldts";

/**
 * The one host form every site check compares: URL-normalized (so `0x7f.1` and `2130706433`
 * become dotted IPv4), lowercased, without v6 brackets, zone, or a trailing dot. Returns null for
 * a host that does not parse, so callers fail closed.
 */
export const normalizeHost = (host: string): string | null => {
  try {
    return new URL(`http://${host}`).hostname
      .replace(/^\[|\]$/g, "")
      .replace(/%.*$/, "")
      .replace(/\.$/, "");
  } catch {
    return null;
  }
};

/**
 * True when a normalized host sits at least one label below a suffix that is a real site boundary,
 * private suffixes included (`example.com`, `foo.github.io` yes; `com`, `co.uk`, `github.io`,
 * `blogspot.com`, `localhost` no).
 *
 * `allowPrivateDomains` is what keeps unrelated sites on a shared host apart: without it every
 * `*.github.io` and `*.blogspot.com` page reduces to `github.io` / `blogspot.com`, so one suffix
 * grant would cover them all. A site check that compares registrable domains must not do that.
 */
export const hasRegistrableDomain = (host: string): boolean =>
  getDomain(host, { allowPrivateDomains: true }) !== null;
