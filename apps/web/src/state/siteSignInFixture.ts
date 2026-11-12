/**
 * The DEV-only fixture source behind the site sign-in seam (decision-53, phase 0). It holds one
 * request record per (thread, site) and drives the same machine the server will: start, join,
 * cancel, dismiss, allow, submit and finish. The card derives from the record, so a click that
 * works here works after phase 1 swaps this module for the RPC.
 *
 * Loaded only through `siteSignInFixtureLoader`, behind `import.meta.env.DEV`.
 */
import {
  applySiteSignInAction,
  type SiteSignInAction,
  type SiteSignInRequestRecord,
} from "@isnadi/client-runtime/browser-auth";

export const FIXTURE_SITE = "mail.google.com";

const FIXTURE_START_URL = "https://mail.google.com/";

const FIXTURE_REASON = "Read the launch thread and reply to Dana.";

/** How long the fixture form "submits" before the flow finishes. */
const FINISH_DELAY_MS = 1_200;

/** What the fixture flow finds when the form is submitted, set by the dev picker. */
export interface FixtureOutcome {
  readonly checkFailsOnSave: boolean;
}

/** A picker patch: record fields, plus what the flow will find when the form is saved. */
export interface FixturePatch {
  readonly state?: SiteSignInRequestRecord["state"];
  readonly kind?: SiteSignInRequestRecord["kind"];
  readonly submitting?: boolean;
  readonly failureClass?: SiteSignInRequestRecord["failureClass"];
  readonly hasSavedPassword?: boolean;
  readonly pcRouted?: boolean;
  readonly checkFailsOnSave?: boolean;
}

export interface SiteSignInFixtureSource {
  subscribe(listener: () => void): () => void;
  /** Records are per (thread, site); a thread shows the one open request it has. */
  recordForThread(threadId: string): SiteSignInRequestRecord | null;
  /** Gives the open chat a fresh Asking request when it has none, as a real request would. */
  ensureAsking(threadId: string, botId: string): void;
  /** Sends one transition to the request, whichever client caused it. */
  act(requestId: string, action: SiteSignInAction): void;
  /** The form's Save: submits now and finishes the way the picker declared it will. */
  submitForm(requestId: string): void;
  /** Runs the asking expiry the server runs at the end of the owner's wait. */
  expireNow(requestId: string): void;
  /** The dev picker writes the record; it never sets a card. */
  setRecord(requestId: string, patch: FixturePatch): void;
}

const keyFor = (threadId: string, site: string) => `${threadId}::${site}`;

function createSource(): SiteSignInFixtureSource {
  const records = new Map<string, SiteSignInRequestRecord>();
  const outcomes = new Map<string, FixtureOutcome>();
  const listeners = new Set<() => void>();

  const changed = () => {
    for (const listener of listeners) listener();
  };

  const find = (requestId: string): SiteSignInRequestRecord | null => {
    for (const record of records.values()) {
      if (record.requestId === requestId) return record;
    }

    return null;
  };

  const recordForThread = (threadId: string): SiteSignInRequestRecord | null => {
    for (const record of records.values()) {
      if (record.threadId === threadId) return record;
    }

    return null;
  };

  const put = (record: SiteSignInRequestRecord) => {
    records.set(keyFor(record.threadId, record.site), record);
    changed();
  };

  const act = (requestId: string, action: SiteSignInAction) => {
    const record = find(requestId);

    if (record === null) return;

    put(applySiteSignInAction(record, action));
  };

  const finish = (requestId: string) => {
    const record = find(requestId);

    if (record === null) return;

    const declared = outcomes.get(requestId) ?? { checkFailsOnSave: false };

    act(requestId, {
      type: "finish",
      now: Date.now(),
      signedIn: record.failureClass === null && !declared.checkFailsOnSave,
    });
  };

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    recordForThread,
    ensureAsking(threadId, botId) {
      if (recordForThread(threadId) !== null) return;

      const now = Date.now();

      records.set(keyFor(threadId, FIXTURE_SITE), {
        requestId: `fixture-sign-in-${threadId}-${now}`,
        threadId,
        botId,
        site: FIXTURE_SITE,
        kind: "sign-in",
        state: "asking",
        reason: FIXTURE_REASON,
        startUrl: FIXTURE_START_URL,
        submitting: false,
        failureClass: null,
        hasSavedPassword: false,
        pcRouted: false,
        egress: "ok",
        checkFailed: false,
        askingElapsedMs: 0,
        askingSince: now,
        settledAt: null,
      });
      changed();
    },
    act,
    submitForm(requestId) {
      act(requestId, { type: "submit", now: Date.now() });

      window.setTimeout(() => finish(requestId), FINISH_DELAY_MS);
    },
    expireNow(requestId) {
      act(requestId, { type: "expire", now: Date.now() });
    },
    setRecord(requestId, patch) {
      const record = find(requestId);

      if (record === null) return;

      const { checkFailsOnSave, ...fields } = patch;

      if (checkFailsOnSave !== undefined) outcomes.set(requestId, { checkFailsOnSave });

      const asking = fields.state === "asking" && record.state !== "asking";
      const pcRouted = fields.pcRouted ?? record.pcRouted;

      put({
        ...record,
        ...fields,
        // A picked flow waits on the PC until its Retry, exactly as a started one does.
        egress: pcRouted && fields.state === "in_progress" ? "pending" : "ok",
        // A picked state starts its own clocks: an asking wait begins now, a flow has none.
        ...(asking ? { askingSince: Date.now(), askingElapsedMs: 0 } : {}),
        ...(fields.state !== undefined && fields.state !== "asking" ? { askingSince: null } : {}),
      });
    },
  };
}

/** One source per browser tab, so every chat reads the same records. */
export const siteSignInFixtureSource: SiteSignInFixtureSource = createSource();
