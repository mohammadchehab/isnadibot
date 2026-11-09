import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsnadiBotUsageInput,
  IsnadiBotUsageSnapshot,
  IsnadiStepUsageSnapshot,
} from "./isnadiUsage.ts";

const decodeEffectIsnadiBotUsageSnapshot = Schema.decodeUnknownEffect(IsnadiBotUsageSnapshot);

const decodeEffectIsnadiBotUsageInput = Schema.decodeUnknownEffect(IsnadiBotUsageInput);

const decodeEffectIsnadiStepUsageSnapshot = Schema.decodeUnknownEffect(IsnadiStepUsageSnapshot);

it.effect("decodes bot usage with unavailable provider totals", () =>
  Effect.gen(function* () {
    const snapshot = yield* decodeEffectIsnadiBotUsageSnapshot({
      botId: "bot-1",
      consumedTokens: 12,
      reservedTokens: 32,
      measurements: {
        input: { tokens: 5, unavailableEntries: 0 },
        output: { tokens: 7, unavailableEntries: 0 },
        observer: { tokens: 0, unavailableEntries: 1 },
        reflector: { tokens: 0, unavailableEntries: 1 },
      },
      entries: [],
      estimatedCost: { status: "unavailable", usd: null },
      subscriptionPool: { status: "unavailable", used: null, limit: null, unit: null },
    });

    assert.strictEqual(snapshot.consumedTokens, 12);
    assert.strictEqual(snapshot.estimatedCost.status, "unavailable");
  }),
);

it.effect("decodes a windowed bot usage request and summary", () =>
  Effect.gen(function* () {
    const input = yield* decodeEffectIsnadiBotUsageInput({
      botId: "bot-1",
      since: "2026-08-01T00:00:00.000Z",
    });

    assert.strictEqual(input.since, "2026-08-01T00:00:00.000Z");

    const snapshot = yield* decodeEffectIsnadiBotUsageSnapshot({
      botId: "bot-1",
      consumedTokens: 12,
      reservedTokens: 0,
      measurements: {
        input: { tokens: 5, unavailableEntries: 0 },
        output: { tokens: 7, unavailableEntries: 0 },
        observer: { tokens: 0, unavailableEntries: 0 },
        reflector: { tokens: 0, unavailableEntries: 0 },
      },
      entries: [],
      estimatedCost: { status: "unavailable", usd: null },
      subscriptionPool: { status: "unavailable", used: null, limit: null, unit: null },
      window: { since: "2026-08-01T00:00:00.000Z", turns: 3, tokens: 12 },
    });

    assert.deepStrictEqual(snapshot.window, {
      since: "2026-08-01T00:00:00.000Z",
      turns: 3,
      tokens: 12,
    });
  }),
);

it.effect("decodes settled step usage with an estimated cost", () =>
  Effect.gen(function* () {
    const snapshot = yield* decodeEffectIsnadiStepUsageSnapshot({
      botId: "bot-1",
      engine: { provider: "codex", model: "gpt-5.6-sol" },
      tokens: 1_500,
      estimatedCost: { status: "available", usd: 0.42 },
    });

    assert.strictEqual(snapshot.tokens, 1_500);
    assert.deepStrictEqual(snapshot.estimatedCost, { status: "available", usd: 0.42 });
  }),
);
