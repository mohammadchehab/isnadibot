import { ProviderDriverKind } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  CONSERVATIVE_LIVENESS_WINDOW_MS,
  MIN_LIVENESS_WINDOW_MS,
  livenessWindowMsFor,
} from "./LivenessWindow.ts";

describe("provider liveness windows", () => {
  it("doubles a provider's declared ceiling", () => {
    // Claude's ceiling is ten minutes, so its window is twenty. Pinned as a literal: importing the
    // constant would let a change to the ceiling or the factor pass without the test noticing.
    expect(livenessWindowMsFor(ProviderDriverKind.make("claudeAgent"))).toBe(20 * 60 * 1_000);
  });

  it("gives an unmeasured provider the conservative default", () => {
    expect(livenessWindowMsFor(ProviderDriverKind.make("codex"))).toBe(
      CONSERVATIVE_LIVENESS_WINDOW_MS,
    );
    // A driver this build has never heard of is unmeasured too, so it errs towards staying open.
    expect(livenessWindowMsFor(ProviderDriverKind.make("some-future-driver"))).toBe(
      CONSERVATIVE_LIVENESS_WINDOW_MS,
    );
  });

  it("keeps every built-in provider at or above the floor", () => {
    const providers = [
      "codex",
      "claudeAgent",
      "grok",
      "kimi",
      "opencode",
      "opencodeGo",
      "customOpenai",
      "cursor",
    ];

    for (const provider of providers) {
      expect(livenessWindowMsFor(ProviderDriverKind.make(provider))).toBeGreaterThanOrEqual(
        MIN_LIVENESS_WINDOW_MS,
      );
    }
  });

  it("is longer than the ceiling it doubles, so a turn on the ceiling is still alive", () => {
    expect(livenessWindowMsFor(ProviderDriverKind.make("claudeAgent"))).toBeGreaterThan(
      10 * 60 * 1_000,
    );
  });
});
