import { describe, expect, it } from "vite-plus/test";

import {
  CLASSIFY_CHAR_LIMIT,
  classifyModelFailure,
  decodeProviderError,
  MAX_RETRY_AFTER_MS,
  MODEL_FAILURE_PATTERNS,
  modelFailureInputFromError,
  retryAfterMsFrom,
  type ModelFailureClass,
  type ModelFailureInput,
} from "./modelFailure.ts";

const cases: ReadonlyArray<readonly [string, ModelFailureInput, ModelFailureClass]> = [
  ["429 status", { message: "Request failed", statusCode: 429 }, "rate-limit"],
  ["too many requests", { message: "Too Many Requests" }, "rate-limit"],
  ["rate limit wording", { message: "Rate limit exceeded for gpt" }, "rate-limit"],
  ["429 in the text", { message: "HTTP 429" }, "rate-limit"],
  ["anthropic rate_limit_error", { message: "Error", errorType: "rate_limit_error" }, "rate-limit"],
  [
    "usage limit",
    { message: "You have reached your usage limit. Try again in 2h." },
    "usage-limit",
  ],
  ["quota", { message: "You exceeded your current quota" }, "usage-limit"],
  ["usage cap", { message: "Usage cap hit" }, "usage-limit"],
  ["limit reached", { message: "Daily limit reached" }, "usage-limit"],
  ["hit your limit", { message: "You've hit your weekly limit" }, "usage-limit"],
  ["spending limit", { message: "Spending limit exceeded" }, "usage-limit"],
  ["budget exceeded", { message: "budget exceeded" }, "usage-limit"],
  ["max usage", { message: "Max usage for this plan" }, "usage-limit"],
  ["usage wording beats a 429", { message: "Usage limit reached", statusCode: 429 }, "usage-limit"],
  ["insufficient_quota type", { message: "Error", errorType: "insufficient_quota" }, "usage-limit"],
  ["500", { message: "Internal error", statusCode: 500 }, "overloaded"],
  ["502", { message: "Bad gateway", statusCode: 502 }, "overloaded"],
  ["503", { message: "Unavailable", statusCode: 503 }, "overloaded"],
  ["504", { message: "Gateway timeout", statusCode: 504 }, "overloaded"],
  ["529", { message: "Overloaded", statusCode: 529 }, "overloaded"],
  ["overloaded_error type", { message: "Error", errorType: "overloaded_error" }, "overloaded"],
  ["connection reset", { message: "read ECONNRESET" }, "overloaded"],
  ["timeout", { message: "Request timed out" }, "overloaded"],
  ["socket hang up", { message: "socket hang up" }, "overloaded"],
  ["401", { message: "Nope", statusCode: 401 }, "unavailable"],
  ["403", { message: "Forbidden", statusCode: 403 }, "unavailable"],
  [
    "an auth status beats quota wording in the body",
    { message: "You have exceeded your quota", statusCode: 401 },
    "unavailable",
  ],
  [
    "an auth status beats rate-limit wording in the body",
    { message: "slow down, retry after 30s", statusCode: 403 },
    "unavailable",
  ],
  ["unknown model", { message: "Unknown model gpt-9" }, "unavailable"],
  [
    "model not found",
    { message: "The model `foo` does not exist", statusCode: 404 },
    "unavailable",
  ],
  ["invalid api key", { message: "Invalid API key" }, "unavailable"],
  ["bad request", { message: "Invalid parameter", statusCode: 400 }, "request"],
  ["context too long", { message: "maximum context length exceeded", statusCode: 400 }, "request"],
  ["content refused", { message: "Content blocked by safety policy", statusCode: 400 }, "request"],
  ["payload too large", { message: "Payload too large", statusCode: 413 }, "request"],
  ["unclassified", { message: "something odd happened" }, "request"],
];

describe("classifyModelFailure", () => {
  it.each(cases)("%s", (_name, input, expected) => {
    expect(classifyModelFailure(input)).toBe(expected);
  });

  it("reads only the head of the message, so a phrase past the cut does not classify", () => {
    const padded = `${"x".repeat(CLASSIFY_CHAR_LIMIT)} usage limit`;

    expect(classifyModelFailure({ message: padded })).toBe("request");
    expect(
      classifyModelFailure({ message: `${"x".repeat(CLASSIFY_CHAR_LIMIT - 12)} usage limit` }),
    ).toBe("usage-limit");
  });

  it("caps the error type too, because a provider writes it", () => {
    expect(
      classifyModelFailure({ message: "x".repeat(CLASSIFY_CHAR_LIMIT), errorType: "quota" }),
    ).toBe("request");
  });

  it("classifies a 1 MB body in bounded time, reading only the head", () => {
    const started = performance.now();

    expect(classifyModelFailure({ message: "hit your ".repeat(125_000) })).toBe("request");

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("MODEL_FAILURE_PATTERNS", () => {
  /**
   * A Custom API endpoint is an arbitrary host, so its error body is hostile input. Each of these
   * strings repeats the literal a pattern looks for without ever closing the phrase, which is the
   * shape an unbounded quantifier turns quadratic. The bound is generous on purpose: linear time
   * finishes these in milliseconds, and quadratic time does not finish at all.
   */
  const adversarial: ReadonlyArray<readonly [string, string]> = [
    ["hit your", "hit your ".repeat(200_000)],
    ["model", "model ".repeat(170_000)],
    ["model without a full stop", `model${"a".repeat(1_000_000)}`],
    ["one long word", "a".repeat(1_000_000)],
  ];

  it("runs every pattern in linear time on adversarial input", () => {
    const started = performance.now();

    for (const [, text] of adversarial) {
      for (const pattern of MODEL_FAILURE_PATTERNS) {
        expect(pattern.test(text)).toBe(false);
      }
    }

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

const NOW = Date.parse("2026-11-12T00:00:00.000Z");

const retryAfterCases: ReadonlyArray<readonly [string, string, number | undefined]> = [
  ["seconds", "30", 30_000],
  ["exactly a day", "86400", MAX_RETRY_AFTER_MS],
  ["past a day", "86401", MAX_RETRY_AFTER_MS],
  ["a huge count of seconds", "999999999", MAX_RETRY_AFTER_MS],
  ["zero", "0", undefined],
  ["whitespace", " 5 ", undefined],
  ["hex", "0x10", undefined],
  ["exponent", "1e3", undefined],
  ["overflowing exponent", "1e308", undefined],
  ["negative", "-1", undefined],
  ["NaN", "NaN", undefined],
  ["Infinity", "Infinity", undefined],
  ["empty", "", undefined],
  ["an HTTP-date inside the cap", "Thu, 12 Nov 2026 06:00:00 GMT", 6 * 60 * 60_000],
  ["an HTTP-date past the cap", "Thu, 13 Nov 2026 06:00:00 GMT", MAX_RETRY_AFTER_MS],
  ["an HTTP-date in the past", "Wed, 11 Nov 2026 06:00:00 GMT", undefined],
  ["a malformed date", "not a date", undefined],
];

describe("retryAfterMsFrom", () => {
  it.each(retryAfterCases)("%s", (_name, value, expected) => {
    expect(retryAfterMsFrom(value, NOW)).toBe(expected);
  });

  it.each([
    ["a number", 30],
    ["an array", ["30"]],
    ["a boolean", true],
    ["null", null],
  ])("drops %s header value at the boundary", (_name, value) => {
    expect(
      modelFailureInputFromError(
        decodeProviderError({ statusCode: 429, responseHeaders: { "retry-after": value } }),
        "slow down",
        NOW,
      ).retryAfterMs,
    ).toBeUndefined();
  });
});

describe("modelFailureInputFromError", () => {
  it("reads status, Retry-After seconds and the provider error type", () => {
    expect(
      modelFailureInputFromError(
        decodeProviderError({
          statusCode: 429,
          responseHeaders: { "retry-after": "30" },
          data: { error: { type: "rate_limit_error" } },
        }),
        "slow down",
        NOW,
      ),
    ).toEqual({
      message: "slow down",
      statusCode: 429,
      retryAfterMs: 30_000,
      errorType: "rate_limit_error",
    });
  });

  it("ignores an HTTP-date Retry-After that has already passed", () => {
    expect(
      modelFailureInputFromError(
        decodeProviderError({
          statusCode: 503,
          responseHeaders: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
        }),
        "busy",
        NOW,
      ),
    ).toEqual({ message: "busy", statusCode: 503, retryAfterMs: undefined, errorType: undefined });
  });

  it("reads an HTTP-date Retry-After that is still ahead", () => {
    expect(
      modelFailureInputFromError(
        decodeProviderError({
          statusCode: 503,
          responseHeaders: { "retry-after": "Thu, 12 Nov 2026 06:00:00 GMT" },
        }),
        "busy",
        NOW,
      ),
    ).toEqual({
      message: "busy",
      statusCode: 503,
      retryAfterMs: 6 * 60 * 60_000,
      errorType: undefined,
    });
  });

  it("returns only the message for anything that is not an object", () => {
    expect(modelFailureInputFromError(decodeProviderError("boom"), "boom", NOW)).toEqual({
      message: "boom",
    });
    expect(modelFailureInputFromError(decodeProviderError(undefined), "x", NOW)).toEqual({
      message: "x",
    });
  });
});
