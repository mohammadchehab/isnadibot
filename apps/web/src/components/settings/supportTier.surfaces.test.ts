import {
  CHANNEL_PROVIDERS,
  CLOUD_SANDBOX_PROVIDERS,
  SUPPORTED_CHANNELS,
  SUPPORTED_PROVIDERS,
  SUPPORTED_SANDBOX_SERVICES,
  supportTierOf,
} from "@isnadi/contracts";
import { PROVIDER_CONNECTIONS } from "@isnadi/client-runtime/provider-auth";
import { describe, expect, it } from "vite-plus/test";

import { CHANNEL_PROVIDER_META } from "./channelProviderMeta";
import { PROVIDER_CATALOG } from "./providerCatalog";
import { SANDBOX_PROVIDER_DEFINITIONS } from "./SandboxSettingsPanel.logic";

/**
 * The support-tier config is only honest if the surfaces that render it agree
 * with it. Each surface keeps its own list of entries; these tests fail when a
 * list gains an entry the config never tiered, or loses one it still tiers.
 */
describe("support tier surfaces", () => {
  it("tiers every provider the catalog and the shared connection list show", () => {
    const catalogTiers = PROVIDER_CATALOG.map((entry) => ({
      id: entry.account?.id ?? "custom-api",
      tier: entry.tier,
    }));

    expect(catalogTiers.map((row) => row.id)).toEqual([
      ...SUPPORTED_PROVIDERS,
      "xai",
      "kimi-for-coding",
      "opencode-go",
      "custom-api",
    ]);
    expect(catalogTiers.map((row) => row.id)).toEqual([
      ...PROVIDER_CONNECTIONS.map((provider) => provider.id),
      "custom-api",
    ]);

    for (const row of catalogTiers) expect(row.tier).toBe(supportTierOf("provider", row.id));
  });

  it("tiers every channel the settings overview lists, and only those", () => {
    const shown = CHANNEL_PROVIDER_META.map((meta) => meta.provider);

    expect([...shown].sort()).toEqual([...CHANNEL_PROVIDERS].sort());

    for (const id of shown) expect(supportTierOf("channel", id)).toBeDefined();
  });

  it("tiers every cloud sandbox the settings panel lists", () => {
    const shown = SANDBOX_PROVIDER_DEFINITIONS.map((definition) => definition.id);

    expect([...shown].sort()).toEqual([...CLOUD_SANDBOX_PROVIDERS].sort());
  });

  it("keeps the supported set to one sandbox, two channels and two providers", () => {
    expect(SUPPORTED_SANDBOX_SERVICES).toHaveLength(1);
    expect(SUPPORTED_CHANNELS).toHaveLength(2);
    expect(SUPPORTED_PROVIDERS).toHaveLength(2);
  });
});
