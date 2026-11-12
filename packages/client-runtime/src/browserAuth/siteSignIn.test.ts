import { describe, expect, it } from "vite-plus/test";

import {
  applySiteSignInAction,
  SITE_SIGN_IN_ASKING_LIMIT_MS,
  askingRemainingMs,
  deriveSiteSignInCard,
  type SiteSignInAction,
  type SiteSignInRequestRecord,
} from "./siteSignIn.ts";

const T0 = 1_700_000_000_000;

const record = (patch: Partial<SiteSignInRequestRecord> = {}): SiteSignInRequestRecord => ({
  requestId: `sign-in-${patch.threadId ?? "thread-1"}-mail.google.com`,
  threadId: "thread-1",
  botId: "bot-1",
  site: "mail.google.com",
  kind: "sign-in",
  state: "asking",
  reason: "Read the launch thread and reply to Dana.",
  startUrl: "https://mail.google.com/",
  submitting: false,
  failureClass: null,
  hasSavedPassword: false,
  pcRouted: false,
  egress: "ok",
  checkFailed: false,
  askingElapsedMs: 0,
  askingSince: T0,
  settledAt: null,
  ...patch,
});

const step = (from: SiteSignInRequestRecord, ...actions: SiteSignInAction[]) =>
  actions.reduce(applySiteSignInAction, from);

describe("deriveSiteSignInCard", () => {
  it("derives every card from the request record alone", () => {
    const cases: ReadonlyArray<[string, SiteSignInRequestRecord]> = [
      ["asking", record()],
      ["asking-for-access", record({ kind: "access" })],
      ["signing-in", record({ state: "in_progress", askingSince: null })],
      ["finishing-sign-in", record({ state: "in_progress", submitting: true, askingSince: null })],
      [
        "waiting-for-pc",
        record({ state: "in_progress", askingSince: null, pcRouted: true, egress: "pending" }),
      ],
      ["not-signed-in-yet", record({ state: "in_progress", askingSince: null, checkFailed: true })],
      ["signed-in", record({ state: "signed_in", askingSince: null, settledAt: T0 })],
      [
        "failed",
        record({ state: "failed", askingSince: null, failureClass: "in-use", settledAt: T0 }),
      ],
      [
        "failed-password-saved",
        record({
          state: "failed",
          askingSince: null,
          failureClass: "vault-disabled",
          hasSavedPassword: true,
          settledAt: T0,
        }),
      ],
      ["expired", record({ state: "expired", askingSince: null, settledAt: T0 })],
      ["not-now", record({ state: "dismissed", askingSince: null, settledAt: T0 })],
    ];

    for (const [card, input] of cases) {
      expect(deriveSiteSignInCard(input).id, card).toBe(card);
    }
  });

  it("refuses every way out once the form is submitting", () => {
    const card = deriveSiteSignInCard(
      record({
        state: "in_progress",
        submitting: true,
        askingSince: null,
        pcRouted: true,
        egress: "pending",
      }),
    );

    expect(card.id).toBe("finishing-sign-in");
    expect(card.actions).toEqual([]);
  });

  it("offers Allow, not a form, for a request for access", () => {
    const card = deriveSiteSignInCard(record({ kind: "access" }));

    expect(card.actions).toEqual(["allow", "not-now"]);
    expect(card.primaryOpensForm).toBe(false);
  });
});

describe("applySiteSignInAction", () => {
  it("starts a flow from asking and from failed", () => {
    for (const state of ["asking", "failed"] as const) {
      const started = applySiteSignInAction(
        record({ state, failureClass: state === "failed" ? "in-use" : null }),
        { type: "start", now: T0 + 1_000 },
      );

      expect(started.state).toBe("in_progress");
      expect(started.submitting).toBe(false);
      expect(deriveSiteSignInCard(started).id).toBe("signing-in");
    }
  });

  it("resumes the asking clock across a Cancel instead of restarting it", () => {
    const started = applySiteSignInAction(record(), { type: "start", now: T0 + 60_000 });
    const cancelled = applySiteSignInAction(started, { type: "cancel", now: T0 + 120_000 });

    expect(cancelled.state).toBe("asking");
    expect(cancelled.askingElapsedMs).toBe(60_000);
    expect(cancelled.askingSince).toBe(T0 + 120_000);
    expect(askingRemainingMs(cancelled, T0 + 120_000)).toBe(SITE_SIGN_IN_ASKING_LIMIT_MS - 60_000);
  });

  it("refuses Cancel from submitting on", () => {
    const submitting = step(
      record(),
      { type: "start", now: T0 },
      { type: "submit", now: T0 + 1_000 },
    );

    const cancelled = applySiteSignInAction(submitting, { type: "cancel", now: T0 + 2_000 });

    expect(cancelled.state).toBe("in_progress");
    expect(cancelled.submitting).toBe(true);
  });

  it("drops a completion that arrives after the owner declined or the request expired", () => {
    const dismissed = applySiteSignInAction(record(), { type: "dismiss", now: T0 + 1_000 });

    expect(deriveSiteSignInCard(dismissed).id).toBe("not-now");
    expect(
      applySiteSignInAction(dismissed, { type: "finish", now: T0 + 2_000, signedIn: true }).state,
    ).toBe("dismissed");

    const expired = applySiteSignInAction(record(), { type: "expire", now: T0 + 600_000 });

    expect(expired.state).toBe("expired");
    expect(
      applySiteSignInAction(expired, { type: "finish", now: T0 + 600_001, signedIn: true }).state,
    ).toBe("expired");
  });

  it("never expires a flow", () => {
    const running = applySiteSignInAction(record(), { type: "start", now: T0 });

    expect(applySiteSignInAction(running, { type: "expire", now: T0 + 600_000 }).state).toBe(
      "in_progress",
    );
  });

  it("saves after submitting, and marks the check that did not hold", () => {
    const signedIn = step(
      record(),
      { type: "start", now: T0 },
      { type: "submit", now: T0 + 1_000 },
      { type: "finish", now: T0 + 2_000, signedIn: true },
    );

    expect(signedIn.state).toBe("signed_in");
    expect(deriveSiteSignInCard(signedIn).id).toBe("signed-in");

    const notHeld = step(
      record(),
      { type: "start", now: T0 },
      { type: "submit", now: T0 + 1_000 },
      { type: "finish", now: T0 + 2_000, signedIn: false },
    );

    expect(notHeld.state).toBe("in_progress");
    expect(deriveSiteSignInCard(notHeld).id).toBe("not-signed-in-yet");

    const kept = applySiteSignInAction(notHeld, { type: "keep-flow", now: T0 + 3_000 });

    expect(deriveSiteSignInCard(kept).id).toBe("signing-in");
  });

  it("fails with the flow's class, and says so differently when a password is saved", () => {
    const failed = step(
      record({ failureClass: "in-use" }),
      { type: "start", now: T0 },
      { type: "submit", now: T0 + 1_000 },
      { type: "finish", now: T0 + 2_000, signedIn: false },
    );

    expect(failed.state).toBe("failed");
    expect(deriveSiteSignInCard(failed).id).toBe("failed");
    expect(deriveSiteSignInCard({ ...failed, hasSavedPassword: true }).id).toBe(
      "failed-password-saved",
    );
  });

  it("turns an access request into a grant on Allow, and nothing else", () => {
    const granted = applySiteSignInAction(record({ kind: "access" }), { type: "allow", now: T0 });

    expect(granted.state).toBe("signed_in");
    expect(
      applySiteSignInAction(record({ kind: "access" }), { type: "expire", now: T0 }).state,
    ).toBe("expired");
    expect(
      applySiteSignInAction(record({ kind: "access" }), { type: "start", now: T0 }).state,
    ).toBe("asking");
  });

  it("waits for the owner's PC only while the egress check is pending", () => {
    const started = applySiteSignInAction(record({ pcRouted: true }), { type: "start", now: T0 });

    expect(deriveSiteSignInCard(started).id).toBe("waiting-for-pc");

    const retried = applySiteSignInAction(started, { type: "retry", now: T0 + 5_000 });

    expect(deriveSiteSignInCard(retried).id).toBe("signing-in");
    expect(applySiteSignInAction(started, { type: "dismiss", now: T0 + 5_000 }).state).toBe(
      "dismissed",
    );
  });

  it("keeps a second client's Sign in on the flow that already exists", () => {
    const started = applySiteSignInAction(record(), { type: "start", now: T0 });

    const joined = step(
      started,
      { type: "submit", now: T0 + 1_000 },
      { type: "join", now: T0 + 2_000 },
    );

    expect(joined.state).toBe("in_progress");
    expect(joined.submitting).toBe(true);
  });
});
