import type { ServerProvider, ServerProviderUnavailability } from "@isnadi/contracts";

/**
 * Why a provider instance cannot run a turn right now. The server's turn
 * preflight uses the same order, so a client that shows a reason shows the one
 * the server would refuse with.
 *
 * This lives in the shared package, without any presentation, because hiring a
 * fleet resolves a role's engine on the server: the plan the client previews
 * and the plan the server stamps must come from one function.
 */
export type ProviderAvailabilityReason =
  | ServerProviderUnavailability
  | "disabled"
  | "not-installed"
  | "missing-provider";

/** Whether signing in is the fix, so a repair button can say "Connect". */
export function providerReasonNeedsSignIn(
  reason: ProviderAvailabilityReason | null | undefined,
): boolean {
  return reason === "missing-login" || reason === "expired-login" || reason === "missing-provider";
}

export function providerAvailabilityReason(
  provider: ServerProvider | undefined,
  model?: string | null,
): ProviderAvailabilityReason | null {
  if (!provider) return "missing-provider";

  if (!provider.enabled) return "disabled";

  if (provider.unavailability && provider.unavailability !== "temporary-failure") {
    return provider.unavailability;
  }

  if (
    !provider.installed ||
    (provider.availability === "unavailable" && provider.status !== "error")
  ) {
    return "not-installed";
  }

  if (provider.auth.status === "unauthenticated") return "missing-login";

  if (
    model &&
    provider.models.length > 0 &&
    !provider.models.some((candidate) => candidate.slug === model)
  ) {
    return "unsupported-model";
  }

  if (provider.unavailability === "temporary-failure") return "temporary-failure";

  return null;
}
