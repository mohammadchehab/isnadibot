import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { OrchestrationThreadActivity, ThreadTokenUsageSnapshot } from "@isnadi/contracts";

/** Keep each valid stored field when adjacent fields are missing or malformed. */
function storedField<S extends Schema.Top>(schema: S, fallback: NoInfer<S["Type"]>) {
  const recovered = Schema.catchDecoding<S>(() => Effect.succeed(Option.some(fallback)))(schema);

  return Schema.withDecodingDefaultType<typeof recovered>(Effect.succeed(fallback))(recovered);
}

const StoredContextWindow = Schema.Struct({
  usedTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  totalProcessedTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  maxTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  inputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  cachedInputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  outputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  reasoningOutputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  lastUsedTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  lastInputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  lastCachedInputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  lastOutputTokens: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  lastReasoningOutputTokens: storedField(
    Schema.NullOr(Schema.Number.check(Schema.isFinite())),
    null,
  ),
  toolUses: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  durationMs: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  autoCompactThreshold: storedField(Schema.NullOr(Schema.Number.check(Schema.isFinite())), null),
  compactsAutomatically: storedField(Schema.Boolean, false),
});

const decodeContextWindow = Schema.decodeUnknownOption(StoredContextWindow);

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
};

/**
 * The context a chat last reported, read from its activities alone. Both the
 * web and mobile clients render it, so it lives here rather than in either.
 * A malformed payload on the newest event skips to the one before it.
 */
export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];

    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }

    const decoded = decodeContextWindow(activity.payload);

    if (Option.isNone(decoded)) continue;
    const payload = decoded.value;
    const usedTokens = payload.usedTokens;

    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    const maxTokens = payload.maxTokens;

    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;

    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;

    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: payload.totalProcessedTokens,
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: payload.inputTokens,
      cachedInputTokens: payload.cachedInputTokens,
      outputTokens: payload.outputTokens,
      reasoningOutputTokens: payload.reasoningOutputTokens,
      lastUsedTokens: payload.lastUsedTokens,
      lastInputTokens: payload.lastInputTokens,
      lastCachedInputTokens: payload.lastCachedInputTokens,
      lastOutputTokens: payload.lastOutputTokens,
      lastReasoningOutputTokens: payload.lastReasoningOutputTokens,
      toolUses: payload.toolUses,
      durationMs: payload.durationMs,
      compactsAutomatically: payload.compactsAutomatically,
      autoCompactThreshold: payload.autoCompactThreshold,
      updatedAt: activity.createdAt,
    };
  }

  return null;
}
