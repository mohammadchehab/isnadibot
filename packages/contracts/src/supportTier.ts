/**
 * Support tiers: the small core of the product we stand behind, and everything
 * else we ship as experimental.
 *
 * One config that the server, web and mobile read, so a surface cannot invent
 * its own list. It holds ids and tiers only; the labels users see stay where
 * the catalogues already live (`providerCatalog.ts`, `channelProviderMeta.tsx`,
 * `PROVIDER_CONNECTIONS`). Anything nobody tiered here is experimental, so a
 * new provider shows up as experimental until someone promotes it deliberately.
 */
import { CHANNEL_PROVIDERS, type ChannelProvider } from "./orchestration/roster.ts";
import { CLOUD_SANDBOX_PROVIDERS, type CloudSandboxProvider } from "./settings/sandbox.ts";
import { SubscriptionProviderId } from "./subscriptionAuth.ts";

export const SUPPORTED_SANDBOX_SERVICES = [
  "daytona",
] as const satisfies readonly CloudSandboxProvider[];

export const SUPPORTED_CHANNELS = [
  "slack",
  "discord",
] as const satisfies readonly ChannelProvider[];

export const SUPPORTED_PROVIDERS = [
  "openai-codex",
  "anthropic",
] as const satisfies readonly SubscriptionProviderId[];

export const SUPPORT_TIER_KINDS = ["sandbox", "channel", "provider"] as const;

export type SupportTierKind = (typeof SUPPORT_TIER_KINDS)[number];

export type SupportTier = "supported" | "experimental";

const SUPPORTED_IDS: Readonly<Record<SupportTierKind, readonly string[]>> = {
  sandbox: SUPPORTED_SANDBOX_SERVICES,
  channel: SUPPORTED_CHANNELS,
  provider: SUPPORTED_PROVIDERS,
};

/**
 * The tier a surface shows for one entry. Fails closed: an id this config does
 * not name is experimental, never supported.
 */
export function supportTierOf(kind: SupportTierKind, id: string): SupportTier {
  const supported: readonly string[] | undefined = SUPPORTED_IDS[kind];

  return supported !== undefined && supported.includes(id) ? "supported" : "experimental";
}

export interface SupportTierEntry {
  readonly kind: SupportTierKind;
  readonly id: string;
  readonly tier: SupportTier;
}

function entry(kind: SupportTierKind, id: string): SupportTierEntry {
  return { kind, id, tier: supportTierOf(kind, id) };
}

/**
 * Every tiered entry, derived from the provider lists rather than typed out
 * again. The user-docs matrix is checked against this so the docs and the
 * config cannot drift apart.
 */
export const SUPPORT_TIER_ENTRIES: readonly SupportTierEntry[] = [
  ...CLOUD_SANDBOX_PROVIDERS.map((id) => entry("sandbox", id)),
  ...CHANNEL_PROVIDERS.map((id) => entry("channel", id)),
  ...SubscriptionProviderId.literals.map((id) => entry("provider", id)),
];
