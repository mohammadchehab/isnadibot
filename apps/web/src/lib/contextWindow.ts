import {
  deriveLatestContextWindowSnapshot,
  type ContextWindowSnapshot,
} from "@isnadi/client-runtime/context-window";

export { deriveLatestContextWindowSnapshot };
export type { ContextWindowSnapshot };

export function formatProviderDisplayName(provider: string | null | undefined): string {
  if (!provider) return "This agent";

  switch (provider) {
    case "claudeAgent":
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "opencodeGo":
      return "OpenCode Go";
    case "customOpenai":
      return "Custom API";
    default: {
      // Title-case unknown driver kinds so they read reasonably.
      const trimmed = provider.replace(/Agent$/i, "").trim();

      if (trimmed.length === 0) return provider;

      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }

  if (value < 1_000) {
    return `${Math.round(value)}`;
  }

  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }

  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }

  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}
