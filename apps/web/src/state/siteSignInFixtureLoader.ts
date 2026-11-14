import type { SiteSignInFixtureSource } from "./siteSignInFixture";

/** `VITE_SITE_SIGNIN_FIXTURE=1` or `?fixture=site-signin` turns the fixtures on for one run. */
const FIXTURE_FLAG = "1";

const FIXTURE_QUERY_PARAM = "fixture";

const FIXTURE_QUERY_VALUE = "site-signin";

/**
 * Whether this run asked for the site sign-in fixtures. They are opt-in so a normal dev or
 * `dev:desktop` run opens no fake sign-in card on any chat, and no fixtures leak into a demo.
 */
export function siteSignInFixtureEnabled(flag: string | undefined, search: string): boolean {
  if (flag === FIXTURE_FLAG) return true;

  return new URLSearchParams(search).get(FIXTURE_QUERY_PARAM) === FIXTURE_QUERY_VALUE;
}

/**
 * Loads the DEV-only fixture source behind the site sign-in seam, and only when the run opted in.
 * In a shipped build the branch below is gone and so is the chunk: no fixture records, no card,
 * no picker.
 */
export async function loadSiteSignInFixtureSource(): Promise<SiteSignInFixtureSource | null> {
  if (!import.meta.env.DEV) return null;

  if (!siteSignInFixtureEnabled(import.meta.env.VITE_SITE_SIGNIN_FIXTURE, window.location.search)) {
    return null;
  }

  const { siteSignInFixtureSource } = await import("./siteSignInFixture.ts");

  return siteSignInFixtureSource;
}
