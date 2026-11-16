import { describe, expect, it } from "vite-plus/test";
import {
  fleetRole,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type SubscriptionProviderStatus,
} from "@isnadi/contracts";
import { seedSquadMember } from "@isnadi/shared/fleet";
import {
  apiKeyStartInput,
  apiKeyValidationError,
  filterProvidersBySubscriptionConnection,
  PROVIDER_CONNECTIONS,
  anyProviderHealthChecking,
  providerConnectionLabel,
  providerUsesApiKey,
  providerSupportsBaseUrl,
  withSavedSubscriptionLogin,
} from "./providerAuth.ts";
import { providerAvailabilityReason } from "./providerAvailability.ts";

const status: SubscriptionProviderStatus = {
  provider: "anthropic",
  connected: true,
  dependentBots: [],
  dependentRoutines: [],
};

describe("provider API key forms", () => {
  it("only offers providers supported by API-key login", () => {
    expect(PROVIDER_CONNECTIONS.map((provider) => provider.id)).toEqual([
      "openai-codex",
      "anthropic",
      "xai",
      "kimi-for-coding",
      "opencode-go",
    ]);
  });

  it("starts key authentication without sending the key in the start request", () => {
    expect(apiKeyStartInput("anthropic", " https://proxy.example/v1 ")).toEqual({
      provider: "anthropic",
      authMode: "api-key",
      baseUrl: "https://proxy.example/v1",
    });
    expect(apiKeyStartInput("anthropic", "  ")).toEqual({
      provider: "anthropic",
      authMode: "api-key",
    });
  });

  it("does not send an unsupported Grok endpoint", () => {
    expect(providerSupportsBaseUrl("xai")).toBe(false);
    expect(providerSupportsBaseUrl("anthropic")).toBe(true);
    expect(apiKeyStartInput("xai", "https://proxy.example/v1")).toEqual({
      provider: "xai",
      authMode: "api-key",
    });
  });

  it("requires a nonempty key", () => {
    expect(apiKeyValidationError("  ", "")).toBe("Enter an API key.");
    expect(apiKeyValidationError("key", "")).toBeNull();
  });

  it.each([
    "not a URL",
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com?key=secret",
    "https://example.com#fragment",
  ])("rejects invalid endpoints: %s", (url) => {
    expect(apiKeyValidationError("key", url)).toContain("HTTP or HTTPS");
  });

  it.each(["https://api.example.com/v1", "http://localhost:8080/v1"])(
    "accepts supported endpoints: %s",
    (url) => {
      expect(apiKeyValidationError("key", url)).toBeNull();
    },
  );

  it("does not claim a saved key passed a health check", () => {
    expect(providerConnectionLabel({ ...status, authMode: "api-key", health: "detected" })).toBe(
      "API key saved",
    );
    expect(providerConnectionLabel({ ...status, connected: false })).toBe("Not connected");
    expect(providerConnectionLabel(status)).toBe("OAuth connected");
  });

  it("labels an in-flight health check and reports when to keep refreshing", () => {
    expect(providerConnectionLabel({ ...status, healthChecking: true })).toBe("Checking health…");
    expect(providerConnectionLabel({ ...status, authMode: "api-key", healthChecking: true })).toBe(
      "Checking health…",
    );
    expect(providerConnectionLabel({ ...status, connected: false, healthChecking: true })).toBe(
      "Not connected",
    );
    expect(anyProviderHealthChecking([status, { ...status, healthChecking: true }])).toBe(true);
    expect(anyProviderHealthChecking([status, { ...status, healthChecking: false }])).toBe(false);
    expect(anyProviderHealthChecking(undefined)).toBe(false);
  });

  it("keeps OAuth and legacy OpenCode key status distinct", () => {
    expect(providerUsesApiKey(status)).toBe(false);
    expect(providerUsesApiKey({ ...status, authMode: "api-key" })).toBe(true);
    expect(providerUsesApiKey({ ...status, provider: "opencode-go" })).toBe(true);
  });
});

describe("filterProvidersBySubscriptionConnection", () => {
  const provider = (driver: string, instanceId = driver): ServerProvider => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-13T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  });

  it("keeps only connected built-in subscription providers", () => {
    const providers = [
      provider("codex"),
      provider("claudeAgent"),
      provider("grok"),
      provider("opencode"),
    ];

    const statuses: SubscriptionProviderStatus[] = [
      { ...status, provider: "openai-codex", connected: false, health: "missing" },
      { ...status, provider: "anthropic", connected: false, health: "missing" },
      { ...status, provider: "xai", connected: true, health: "detected" },
    ];

    expect(
      filterProvidersBySubscriptionConnection(providers, statuses).map(
        (candidate) => candidate.instanceId,
      ),
    ).toEqual(["grok", "opencode"]);
  });

  it("preserves custom instances that own their connection", () => {
    const custom = provider("codex", "codex_work");

    expect(filterProvidersBySubscriptionConnection([custom], [])).toEqual([custom]);
  });

  it("preserves configured providers until connection status is available", () => {
    const providers = [provider("codex"), provider("claudeAgent")];

    expect(filterProvidersBySubscriptionConnection(providers, undefined)).toEqual(providers);
  });
});

describe("withSavedSubscriptionLogin", () => {
  const expiredClaude = (instanceId = "claudeAgent"): ServerProvider => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "error",
    auth: { status: "unauthenticated" },
    checkedAt: "2026-09-13T00:00:00.000Z",
    unavailability: "expired-login",
    unavailabilityDetail: "Login expired.",
    models: [],
    slashCommands: [],
    skills: [],
  });

  const reason = (provider: ServerProvider, statuses: ReadonlyArray<SubscriptionProviderStatus>) =>
    providerAvailabilityReason(withSavedSubscriptionLogin(provider, statuses));

  it("lets an expired OAuth login on the saved connection try a refresh", () => {
    expect(reason(expiredClaude(), [{ ...status, health: "expired", authMode: "oauth" }])).toBe(
      null,
    );
  });

  it("keeps revoked, API-key, and custom-instance logins blocked", () => {
    expect(reason(expiredClaude(), [{ ...status, health: "revoked", authMode: "oauth" }])).toBe(
      "expired-login",
    );
    expect(reason(expiredClaude(), [{ ...status, health: "expired", authMode: "api-key" }])).toBe(
      "expired-login",
    );
    expect(
      reason(expiredClaude("claude_work"), [{ ...status, health: "expired", authMode: "oauth" }]),
    ).toBe("expired-login");
  });

  it("keeps a default instance with its own credential blocked", () => {
    const expired = [{ ...status, health: "expired" as const, authMode: "oauth" as const }];

    const ownKey = {
      claudeAgent: {
        driver: ProviderDriverKind.make("claudeAgent"),
        environment: [
          { name: "ANTHROPIC_API_KEY", value: "", sensitive: true, valueRedacted: true },
        ],
      },
    };

    expect(
      providerAvailabilityReason(withSavedSubscriptionLogin(expiredClaude(), expired, ownKey)),
    ).toBe("expired-login");
  });
});

describe("withSavedSubscriptionLogin on a provider the snapshot calls ready", () => {
  // What the server actually sends for a saved login: the CLI probe behind
  // `unavailability` never reads the credential saved in Settings, so a login
  // that was revoked arrives with no mark at all.
  const readyClaude = (instanceId = "claudeAgent"): ServerProvider => ({
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-09-13T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  });

  const oauth = (health: SubscriptionProviderStatus["health"]) => [
    { ...status, health, authMode: "oauth" as const },
  ];

  it("marks a revoked login so the provider stops counting as able to run", () => {
    const revoked = withSavedSubscriptionLogin(readyClaude(), oauth("revoked"));

    expect(providerAvailabilityReason(revoked)).toBe("expired-login");
    expect(revoked.unavailabilityDetail).toBe("The saved provider login was revoked.");
  });

  it("leaves a healthy or an expired login as the snapshot reported it", () => {
    const healthy = withSavedSubscriptionLogin(readyClaude(), oauth("healthy"));
    const expired = withSavedSubscriptionLogin(readyClaude(), oauth("expired"));

    expect(providerAvailabilityReason(healthy)).toBeNull();
    expect(providerAvailabilityReason(expired)).toBeNull();
    expect(expired.unavailability).toBeUndefined();
  });

  it("marks a revoked API-key login too, because the server's revoked rule ignores authMode", () => {
    const revoked = withSavedSubscriptionLogin(readyClaude(), [
      { ...status, health: "revoked", authMode: "api-key" },
    ]);

    expect(providerAvailabilityReason(revoked)).toBe("expired-login");
    expect(revoked.unavailabilityDetail).toBe("The saved provider login was revoked.");
  });

  it("reads a non-default instance from its own status, never from the shared login", () => {
    const scoped = withSavedSubscriptionLogin(readyClaude("claude_work"), [
      {
        ...status,
        instanceId: ProviderInstanceId.make("claude_work"),
        health: "revoked",
        authMode: "oauth",
      },
    ]);

    expect(providerAvailabilityReason(scoped)).toBe("expired-login");

    // The unscoped entry is the driver's shared login, which the default instance
    // owns. Another instance carries its own credential, so it must not inherit
    // the shared login's verdict.
    const shared = withSavedSubscriptionLogin(readyClaude("claude_work"), oauth("revoked"));

    expect(shared.unavailability).toBeUndefined();
  });

  it("stops a role from seeding an engine on a login the server refuses", () => {
    const scout = fleetRole("scout");

    if (scout === undefined) throw new Error("missing role scout");

    const model = {
      slug: scout.model.model,
      name: scout.model.model,
      isCustom: false,
      capabilities: null,
    };

    const seeded = (
      health: SubscriptionProviderStatus["health"],
      authMode: SubscriptionProviderStatus["authMode"] = "oauth",
    ) => {
      const provider = withSavedSubscriptionLogin(readyClaude(), [{ ...status, health, authMode }]);

      return seedSquadMember(scout, [{ ...provider, models: [model] }]);
    };

    expect(seeded("revoked").engine).toBeNull();
    expect(seeded("revoked", "api-key").engine).toBeNull();
    expect(seeded("healthy").engine?.provider).toBe("claudeAgent");
  });
});
