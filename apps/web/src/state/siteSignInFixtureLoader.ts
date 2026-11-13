import type { SiteSignInFixtureSource } from "./siteSignInFixture";

/**
 * Loads the DEV-only fixture source behind the site sign-in seam. In a shipped build the branch
 * below is gone and so is the chunk: no fixture records, no card, no picker.
 */
export async function loadSiteSignInFixtureSource(): Promise<SiteSignInFixtureSource | null> {
  if (!import.meta.env.DEV) return null;

  const { siteSignInFixtureSource } = await import("./siteSignInFixture.ts");

  return siteSignInFixtureSource;
}
