/**
 * The site sign-in seam. The card, Settings › Signed-in sites and the palette read this one module,
 * so swapping the fixture source for the RPC in phase 1 replaces a data source, not a design.
 *
 * Nothing here renders or holds a card state: a request record goes in, the card comes out.
 * See docs/internals/site-signin.md ("States" and "Reaching every state on fixtures").
 */

export type SiteSignInRequestState =
  | "asking"
  | "in_progress"
  | "signed_in"
  | "failed"
  | "dismissed"
  | "expired";

export type SiteSignInRequestKind = "sign-in" | "access";

export type SiteSignInFailureClass =
  | "in-use"
  | "signed-out-meanwhile"
  | "vault-disabled"
  | "signed-out";

/** How the egress self-check against the owner's PC last answered for a PC-routed flow. */
export type SiteSignInEgress = "ok" | "pending" | "offline";

/**
 * One sign-in request: the owner's view of it, one per (thread, site). It carries names and states
 * only — never a cookie, a typed value or a profile path.
 */
export interface SiteSignInRequestRecord {
  readonly requestId: string;
  readonly threadId: string;
  readonly botId: string;
  /** The normalized registrable domain, already punycode when it is an IDN. */
  readonly site: string;
  readonly kind: SiteSignInRequestKind;
  readonly state: SiteSignInRequestState;
  /** Why the bot needs the site, as plain text the card shows verbatim. */
  readonly reason: string | null;
  readonly startUrl: string | null;
  readonly submitting: boolean;
  /** What the flow ends with when it does not sign in; only `failed` shows it. */
  readonly failureClass: SiteSignInFailureClass | null;
  readonly hasSavedPassword: boolean;
  readonly pcRouted: boolean;
  readonly egress: SiteSignInEgress;
  /** The signed-in check did not hold after the last save; the card offers Save again. */
  readonly checkFailed: boolean;
  /** Asking time already spent across earlier Cancels. The clock resumes, it does not restart. */
  readonly askingElapsedMs: number;
  /** When the current asking wait started, or null when no asking wait is running. */
  readonly askingSince: number | null;
  readonly settledAt: number | null;
}

export type SiteSignInCardId =
  | "asking"
  | "asking-for-access"
  | "signing-in"
  | "finishing-sign-in"
  | "signed-in"
  | "not-signed-in-yet"
  | "failed"
  | "failed-password-saved"
  | "expired"
  | "waiting-for-pc"
  | "not-now";

export type SiteSignInCardAction =
  | "sign-in"
  | "not-now"
  | "allow"
  | "cancel"
  | "continue-sign-in"
  | "keep-flow"
  | "save-again"
  | "sign-in-again"
  | "retry";

export interface SiteSignInCard {
  readonly id: SiteSignInCardId;
  readonly tone: "default" | "warning" | "success";
  readonly actions: readonly SiteSignInCardAction[];
  readonly primaryAction: SiteSignInCardAction | null;
  /** Whether the primary action opens the form sheet rather than acting on the record. */
  readonly primaryOpensForm: boolean;
}

const NO_ACTIONS: readonly SiteSignInCardAction[] = [];

const askingCard = (kind: SiteSignInRequestKind): SiteSignInCard =>
  kind === "access"
    ? {
        id: "asking-for-access",
        tone: "default",
        actions: ["allow", "not-now"],
        primaryAction: "allow",
        primaryOpensForm: false,
      }
    : {
        id: "asking",
        tone: "default",
        actions: ["sign-in", "not-now"],
        primaryAction: "sign-in",
        primaryOpensForm: true,
      };

/**
 * The card is a pure function of the request record: every branch below is a row of the state table
 * in docs/internals/site-signin.md, and no screen is allowed to pick a card on its own.
 */
export function deriveSiteSignInCard(record: SiteSignInRequestRecord): SiteSignInCard {
  switch (record.state) {
    case "asking":
      return askingCard(record.kind);
    case "in_progress": {
      // `submitting` beats Cancel, so it is decided before any state that offers a way out.
      if (record.submitting) {
        return {
          id: "finishing-sign-in",
          tone: "default",
          actions: NO_ACTIONS,
          primaryAction: null,
          primaryOpensForm: false,
        };
      }

      if (record.pcRouted && record.egress === "pending") {
        return {
          id: "waiting-for-pc",
          tone: "warning",
          actions: ["retry", "not-now"],
          primaryAction: "retry",
          primaryOpensForm: false,
        };
      }

      if (record.checkFailed) {
        return {
          id: "not-signed-in-yet",
          tone: "warning",
          actions: ["keep-flow", "save-again"],
          primaryAction: "save-again",
          primaryOpensForm: true,
        };
      }

      return {
        id: "signing-in",
        tone: "default",
        actions: ["cancel", "continue-sign-in"],
        primaryAction: "continue-sign-in",
        primaryOpensForm: false,
      };
    }

    case "signed_in":
      return {
        id: "signed-in",
        tone: "success",
        actions: NO_ACTIONS,
        primaryAction: null,
        primaryOpensForm: false,
      };
    case "failed":
      return record.hasSavedPassword
        ? {
            id: "failed-password-saved",
            tone: "warning",
            actions: ["sign-in-again"],
            primaryAction: "sign-in-again",
            primaryOpensForm: true,
          }
        : {
            id: "failed",
            tone: "warning",
            actions: ["sign-in-again"],
            primaryAction: "sign-in-again",
            primaryOpensForm: true,
          };
    case "expired":
      return {
        id: "expired",
        tone: "default",
        actions: NO_ACTIONS,
        primaryAction: null,
        primaryOpensForm: false,
      };
    case "dismissed":
      return {
        id: "not-now",
        tone: "default",
        actions: NO_ACTIONS,
        primaryAction: null,
        primaryOpensForm: false,
      };
  }
}

/** The asking wait: 10 minutes while `asking`, and repeated Cancels cannot extend it. */
export const SITE_SIGN_IN_ASKING_LIMIT_MS = 10 * 60 * 1000;

export function askingRemainingMs(record: SiteSignInRequestRecord, now: number): number {
  if (record.state !== "asking" || record.askingSince === null) return 0;

  const spent = record.askingElapsedMs + Math.max(0, now - record.askingSince);

  return Math.max(0, SITE_SIGN_IN_ASKING_LIMIT_MS - spent);
}

export type SiteSignInAction =
  | { readonly type: "start"; readonly now: number }
  | { readonly type: "join"; readonly now: number }
  | { readonly type: "cancel"; readonly now: number }
  | { readonly type: "dismiss"; readonly now: number }
  | { readonly type: "allow"; readonly now: number }
  | { readonly type: "submit"; readonly now: number }
  | { readonly type: "finish"; readonly now: number; readonly signedIn: boolean }
  | { readonly type: "keep-flow"; readonly now: number }
  | { readonly type: "retry"; readonly now: number }
  | { readonly type: "expire"; readonly now: number }
  | { readonly type: "reset"; readonly now: number };

const withCard = (
  record: SiteSignInRequestRecord,
  patch: Partial<SiteSignInRequestRecord>,
): SiteSignInRequestRecord => ({ ...record, ...patch });

/**
 * The request machine, mirroring the server's decider for the states a client can cause: start,
 * join, cancel, dismiss, allow, submit, finish, keep the flow, retry, expire. Terminal states are
 * final — a completion that arrives after `dismissed` or `expired` is dropped, not applied.
 */
export function applySiteSignInAction(
  record: SiteSignInRequestRecord,
  action: SiteSignInAction,
): SiteSignInRequestRecord {
  const { now } = action;

  switch (action.type) {
    case "start": {
      // Sign in from `asking`, or Sign in again from `failed`: the same compare-and-set.
      if (record.state !== "asking" && record.state !== "failed") return record;

      if (record.kind === "access") return record;

      const askingSpent =
        record.askingElapsedMs +
        (record.askingSince === null ? 0 : Math.max(0, now - record.askingSince));

      return withCard(record, {
        state: "in_progress",
        submitting: false,
        checkFailed: false,
        egress: record.pcRouted ? "pending" : "ok",
        // Asking time already spent is banked, so a Cancel resumes the wait rather than restarting it.
        askingElapsedMs: askingSpent,
        askingSince: null,
        settledAt: null,
      });
    }

    case "join": {
      // A second client's Sign in joins the flow that exists; it never starts another one.
      if (record.state !== "in_progress") return record;

      return withCard(record, { egress: "ok" });
    }

    case "cancel": {
      // Submitting is the point of no return: the result stands even if Cancel arrives.
      if (record.state !== "in_progress" || record.submitting) return record;

      const spent =
        record.askingElapsedMs +
        (record.askingSince === null ? 0 : Math.max(0, now - record.askingSince));

      return withCard(record, {
        state: "asking",
        checkFailed: false,
        egress: "ok",
        askingElapsedMs: spent,
        askingSince: now,
        settledAt: null,
      });
    }

    case "dismiss": {
      // Not now is the only decline. It answers an asking request, and the wait for the owner's PC,
      // which is a pre-flow wait rather than a running flow; a running flow is stopped by Cancel.
      const waitingForPc =
        record.state === "in_progress" &&
        record.pcRouted &&
        record.egress === "pending" &&
        !record.submitting;

      if (record.state !== "asking" && !waitingForPc) return record;

      return withCard(record, { state: "dismissed", askingSince: null, settledAt: now });
    }

    case "allow": {
      if (record.state !== "asking" || record.kind !== "access") return record;

      return withCard(record, { state: "signed_in", askingSince: null, settledAt: now });
    }

    case "submit": {
      if (record.state !== "in_progress" || record.submitting) return record;

      return withCard(record, { submitting: true });
    }

    case "finish": {
      if (record.state !== "in_progress" || !record.submitting) return record;

      if (action.signedIn) {
        return withCard(record, {
          state: "signed_in",
          submitting: false,
          checkFailed: false,
          askingSince: null,
          settledAt: now,
        });
      }

      if (record.failureClass !== null) {
        return withCard(record, {
          state: "failed",
          submitting: false,
          askingSince: null,
          settledAt: now,
        });
      }

      // The flow ended without a session and without a failure class: the check did not hold.
      return withCard(record, { submitting: false, checkFailed: true });
    }

    case "keep-flow": {
      if (!record.checkFailed || record.state !== "in_progress") return record;

      return withCard(record, { checkFailed: false });
    }

    case "retry": {
      if (record.state !== "in_progress" || !record.pcRouted) return record;

      // A retry re-runs the egress check; on fixtures the PC answers this time.
      return withCard(record, { egress: "ok" });
    }

    case "expire": {
      // Expiry cuts an asking wait, never a flow.
      if (record.state !== "asking") return record;

      return withCard(record, { state: "expired", askingSince: null, settledAt: now });
    }

    case "reset": {
      return withCard(record, {
        state: "asking",
        submitting: false,
        failureClass: null,
        checkFailed: false,
        egress: "ok",
        askingElapsedMs: 0,
        askingSince: now,
        settledAt: null,
      });
    }
  }
}
