import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Why a model call failed, as far as the fallback router cares. `rate-limit`, `usage-limit`,
 * `overloaded` and `unavailable` may move a turn to another model; `request` never does, because
 * another model would most likely fail the same way. See docs/internals/model-fallback.md.
 */
export type ModelFailureClass =
  | "rate-limit"
  | "usage-limit"
  | "overloaded"
  | "unavailable"
  | "request";

export interface ModelFailureInput {
  readonly message: string;
  readonly statusCode?: number | undefined;
  /** Seconds-form `Retry-After`, in milliseconds. Carried for the pause; it does not change the class. */
  readonly retryAfterMs?: number | undefined;
  /** The provider's own error type, for example Anthropic's `overloaded_error`. */
  readonly errorType?: string | undefined;
}

export const RATE_LIMIT_PATTERN = /rate[\s_-]?limit|too many requests|\b429\b/i;

/**
 * `hit your …limit` is bounded at 80 characters: a message from a Custom API host is arbitrary
 * text, and an unbounded quantifier between two literals is quadratic on a body that repeats the
 * first one. The same pattern also runs on every provider error in `accountLimits.ts`.
 */
export const USAGE_LIMIT_PATTERN =
  /usage limit|quota|usage cap|limit reached|hit your .{0,80}limit|spending limit|budget exceeded|max usage/i;

const OVERLOADED_STATUS = new Set([500, 502, 503, 504, 529]);

const OVERLOADED_PATTERN =
  /overloaded|service unavailable|econnreset|connection reset|etimedout|timed out|timeout|socket hang up/i;

const UNAVAILABLE_PATTERN =
  /unknown model|no such model|model\b[^.]{0,80}\b(?:not found|does not exist)|invalid api key|unauthorized/i;

/**
 * Every pattern above, for the test that holds each one to linear time. A new pattern belongs
 * here too.
 */
export const MODEL_FAILURE_PATTERNS: ReadonlyArray<RegExp> = [
  RATE_LIMIT_PATTERN,
  USAGE_LIMIT_PATTERN,
  OVERLOADED_PATTERN,
  UNAVAILABLE_PATTERN,
];

/**
 * How much of a failure message the classifier reads. Only the head is provider wording; the
 * rest is whatever an endpoint chose to send, and a message from a Custom API host is an
 * arbitrary size.
 */
export const CLASSIFY_CHAR_LIMIT = 2_000;

/**
 * Sorts one failed model call into a class. An auth status decides before any wording does,
 * because the body is written by whichever endpoint answered. Usage wording is checked next
 * because it carries a reset time; a status code decides when the wording does not.
 */
export function classifyModelFailure(input: ModelFailureInput): ModelFailureClass {
  const text = (input.errorType ? `${input.message} ${input.errorType}` : input.message).slice(
    0,
    CLASSIFY_CHAR_LIMIT,
  );

  if (input.statusCode === 401 || input.statusCode === 403) return "unavailable";

  if (USAGE_LIMIT_PATTERN.test(text)) return "usage-limit";

  if (input.statusCode === 429 || RATE_LIMIT_PATTERN.test(text)) return "rate-limit";

  if (
    (input.statusCode !== undefined && OVERLOADED_STATUS.has(input.statusCode)) ||
    OVERLOADED_PATTERN.test(text)
  ) {
    return "overloaded";
  }

  if (UNAVAILABLE_PATTERN.test(text)) return "unavailable";

  return "request";
}

/** A `Retry-After` longer than this is treated as this: a turn waits a day at most. */
export const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

const RETRY_AFTER_SECONDS = /^\d{1,9}$/;

/** A header reaches this module as a string or not at all; every other shape is parsed away first. */
const decodeRetryAfterHeader = Schema.decodeUnknownOption(Schema.String);

/**
 * Reads a `Retry-After` header value: ASCII digits are seconds, anything else is tried as an
 * HTTP-date. Anything else — hex, an exponent, surrounding whitespace, a date that has passed,
 * zero — gives no value, and nothing here throws; no value means the pause falls back to its
 * backoff. `now` is the clock a date is measured against.
 */
export function retryAfterMsFrom(value: string, now: number): number | undefined {
  if (RETRY_AFTER_SECONDS.test(value)) {
    const ms = Number(value) * 1_000;

    return ms > 0 ? Math.min(ms, MAX_RETRY_AFTER_MS) : undefined;
  }

  const at = Date.parse(value);

  return Number.isFinite(at) && at > now ? Math.min(at - now, MAX_RETRY_AFTER_MS) : undefined;
}

const ProviderErrorShape = Schema.Struct({
  statusCode: Schema.optional(Schema.Number),
  responseHeaders: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  data: Schema.optional(
    Schema.Struct({
      type: Schema.optional(Schema.String),
      error: Schema.optional(Schema.Struct({ type: Schema.optional(Schema.String) })),
    }),
  ),
});

export type ProviderErrorFields = typeof ProviderErrorShape.Type;

/** Run this on a thrown value, then hand the result to `modelFailureInputFromError`. */
export const decodeProviderError = Schema.decodeUnknownOption(ProviderErrorShape);

/**
 * Reads the fields the classifier uses off an error thrown by the AI SDK (`APICallError`), decoded
 * with `decodeProviderError`. Anything that is not shaped like one yields only the message. `now`
 * is the caller's clock, so that a stalled `Retry-After` date is measured against the turn rather
 * than against whatever this module read on its own.
 */
export function modelFailureInputFromError(
  parsed: Option.Option<ProviderErrorFields>,
  message: string,
  now: number,
): ModelFailureInput {
  if (Option.isNone(parsed)) return { message };

  const { statusCode, responseHeaders, data } = parsed.value;
  const retryAfter = decodeRetryAfterHeader(responseHeaders?.["retry-after"]);

  return {
    message,
    statusCode,
    retryAfterMs: Option.isSome(retryAfter) ? retryAfterMsFrom(retryAfter.value, now) : undefined,
    errorType: data?.error?.type ?? data?.type,
  };
}
