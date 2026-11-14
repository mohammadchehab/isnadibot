import { describe, expect, it } from "vite-plus/test";

import { siteSignInFixtureEnabled } from "./siteSignInFixtureLoader";

describe("siteSignInFixtureEnabled", () => {
  it("stays off for a normal dev run, so no chat shows a fake sign-in card", () => {
    expect(siteSignInFixtureEnabled(undefined, "")).toBe(false);
  });

  it("stays off when the flag holds any other value", () => {
    expect(siteSignInFixtureEnabled("0", "")).toBe(false);
    expect(siteSignInFixtureEnabled("true", "")).toBe(false);
  });

  it("turns on with the env flag", () => {
    expect(siteSignInFixtureEnabled("1", "")).toBe(true);
  });

  it("turns on with ?fixture=site-signin", () => {
    expect(siteSignInFixtureEnabled(undefined, "?fixture=site-signin")).toBe(true);
  });

  it("keeps the other query params it carries", () => {
    expect(siteSignInFixtureEnabled(undefined, "?thread=abc&fixture=site-signin")).toBe(true);
  });

  it("ignores a different fixture name", () => {
    expect(siteSignInFixtureEnabled(undefined, "?fixture=other")).toBe(false);
  });
});
