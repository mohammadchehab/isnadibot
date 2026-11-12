import * as Schema from "effect/Schema";

import {
  IsnadiUsageReservationId,
  BotId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";
import { BotEngine } from "./orchestration/roster.ts";

export const IsnadiUsageCategory = Schema.Literals([
  "turn",
  "tool",
  "observer",
  "reflector",
  "extraction",
  "recall",
  "routine",
  "delegated",
]);

export type IsnadiUsageCategory = typeof IsnadiUsageCategory.Type;

export const IsnadiUsageState = Schema.Literals([
  "reserved",
  "reported",
  "unavailable",
  "released",
]);

export type IsnadiUsageState = typeof IsnadiUsageState.Type;

export const IsnadiUsageEntry = Schema.Struct({
  reservationId: IsnadiUsageReservationId,
  sourceKey: TrimmedNonEmptyString,
  botId: BotId,
  threadId: Schema.NullOr(ThreadId),
  turnId: Schema.NullOr(TurnId),
  category: IsnadiUsageCategory,
  state: IsnadiUsageState,
  reservedTokens: NonNegativeInt,
  inputTokens: Schema.NullOr(NonNegativeInt),
  cachedInputTokens: Schema.optional(NonNegativeInt),
  cacheCreationTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.NullOr(NonNegativeInt),
  reasoningTokens: Schema.NullOr(NonNegativeInt),
  provider: Schema.NullOr(ProviderDriverKind),
  model: Schema.NullOr(TrimmedNonEmptyString),
  unavailableReason: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
});

export type IsnadiUsageEntry = typeof IsnadiUsageEntry.Type;

/**
 * Totals over every ledger entry created at or after `since`, counted from the
 * database rather than from the bounded `entries` list. Absent when the reader
 * did not ask for a window.
 */
export const IsnadiBotUsageWindow = Schema.Struct({
  /** Normalised UTC instant echoed back from the request. */
  since: IsoDateTime,
  /** Turns with at least one entry in the window. Entries with no turn are skipped. */
  turns: NonNegativeInt,
  /** Input plus output tokens reported in the window. */
  tokens: NonNegativeInt,
});

export type IsnadiBotUsageWindow = typeof IsnadiBotUsageWindow.Type;

export const IsnadiBotUsageSummary = Schema.Struct({
  botId: BotId,
  consumedTokens: NonNegativeInt,
  reservedTokens: NonNegativeInt,
  measurements: Schema.Struct({
    input: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    output: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    observer: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
    reflector: Schema.Struct({ tokens: NonNegativeInt, unavailableEntries: NonNegativeInt }),
  }),
  entries: Schema.Array(IsnadiUsageEntry),
  /** Present only when the request carried `since`, so older clients still decode. */
  window: Schema.optional(IsnadiBotUsageWindow),
});

export type IsnadiBotUsageSummary = typeof IsnadiBotUsageSummary.Type;

export const IsnadiBotUsageInput = Schema.Struct({
  botId: BotId,
  /** Inclusive UTC instant as an ISO 8601 string. Asks for a windowed summary. */
  since: Schema.optional(IsoDateTime),
});

export type IsnadiBotUsageInput = typeof IsnadiBotUsageInput.Type;

export const IsnadiEstimatedCost = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    usd: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({ status: Schema.Literal("unavailable"), usd: Schema.Null }),
]);

export type IsnadiEstimatedCost = typeof IsnadiEstimatedCost.Type;

export const IsnadiStepUsageSnapshot = Schema.Struct({
  botId: BotId,
  engine: BotEngine,
  tokens: Schema.NullOr(NonNegativeInt),
  estimatedCost: IsnadiEstimatedCost,
});

export type IsnadiStepUsageSnapshot = typeof IsnadiStepUsageSnapshot.Type;

export const IsnadiBotUsageSnapshot = Schema.Struct({
  ...IsnadiBotUsageSummary.fields,
  estimatedCost: IsnadiEstimatedCost,
  subscriptionPool: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("available"),
      used: NonNegativeInt,
      limit: NonNegativeInt,
      unit: TrimmedNonEmptyString,
    }),
    Schema.Struct({
      status: Schema.Literal("unavailable"),
      used: Schema.Null,
      limit: Schema.Null,
      unit: Schema.Null,
    }),
  ]),
});

export type IsnadiBotUsageSnapshot = typeof IsnadiBotUsageSnapshot.Type;

export class IsnadiBotUsageReadError extends Schema.TaggedErrorClass<IsnadiBotUsageReadError>()(
  "IsnadiBotUsageReadError",
  { botId: BotId, detail: TrimmedNonEmptyString },
) {}
