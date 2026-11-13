import { describe, expect, it } from "vite-plus/test";

import { CHANNEL_PROVIDERS } from "./orchestration/roster.ts";
import { CLOUD_SANDBOX_PROVIDERS } from "./settings/sandbox.ts";
import { SubscriptionProviderId } from "./subscriptionAuth.ts";
import {
  SUPPORT_TIER_ENTRIES,
  SUPPORTED_CHANNELS,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SANDBOX_SERVICES,
  type SupportTierKind,
  supportTierOf,
} from "./supportTier.ts";

const tieredIds = (kind: SupportTierKind) =>
  SUPPORT_TIER_ENTRIES.filter((entry) => entry.kind === kind).map((entry) => entry.id);

const isSupported = (supported: readonly string[], id: string) =>
  supported.some((candidate) => candidate === id);

describe("support tiers", () => {
  it("names exactly one sandbox service, two channels and two providers as supported", () => {
    expect(SUPPORTED_SANDBOX_SERVICES).toEqual(["daytona"]);
    expect(SUPPORTED_CHANNELS).toEqual(["slack", "discord"]);
    expect(SUPPORTED_PROVIDERS).toEqual(["openai-codex", "anthropic"]);
  });

  it("only supports ids that the provider contracts actually define", () => {
    for (const id of SUPPORTED_SANDBOX_SERVICES) expect(CLOUD_SANDBOX_PROVIDERS).toContain(id);

    for (const id of SUPPORTED_CHANNELS) expect(CHANNEL_PROVIDERS).toContain(id);

    for (const id of SUPPORTED_PROVIDERS) expect(SubscriptionProviderId.literals).toContain(id);
  });

  it("marks every other entry experimental", () => {
    for (const id of CLOUD_SANDBOX_PROVIDERS) {
      const tier = isSupported(SUPPORTED_SANDBOX_SERVICES, id) ? "supported" : "experimental";

      expect(supportTierOf("sandbox", id)).toBe(tier);
    }

    for (const id of CHANNEL_PROVIDERS) {
      const tier = isSupported(SUPPORTED_CHANNELS, id) ? "supported" : "experimental";

      expect(supportTierOf("channel", id)).toBe(tier);
    }

    for (const id of SubscriptionProviderId.literals) {
      const tier = isSupported(SUPPORTED_PROVIDERS, id) ? "supported" : "experimental";

      expect(supportTierOf("provider", id)).toBe(tier);
    }
  });

  it("treats the custom API provider as experimental because it is not a subscription", () => {
    expect(supportTierOf("provider", "custom-api")).toBe("experimental");
  });

  it("fails closed for an id or kind nobody tiered", () => {
    expect(supportTierOf("sandbox", "someone-elses-sandbox")).toBe("experimental");
    expect(supportTierOf("channel", "")).toBe("experimental");
    expect(supportTierOf("provider", "a-provider-from-next-year")).toBe("experimental");
  });

  it("tiers every entry exactly once, and each entry agrees with supportTierOf", () => {
    expect(tieredIds("sandbox")).toEqual([...CLOUD_SANDBOX_PROVIDERS]);
    expect(tieredIds("channel")).toEqual([...CHANNEL_PROVIDERS]);
    expect(tieredIds("provider")).toEqual([...SubscriptionProviderId.literals]);

    for (const entry of SUPPORT_TIER_ENTRIES) {
      expect(entry.tier).toBe(supportTierOf(entry.kind, entry.id));
    }
  });
});
