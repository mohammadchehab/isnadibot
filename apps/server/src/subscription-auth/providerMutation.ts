import { ProviderInstanceId } from "@isnadi/contracts";
import { subscriptionAuthFailure } from "./failure.ts";
import * as Effect from "effect/Effect";

import { deriveProviderInstanceConfigMap } from "../provider/Layers/ProviderInstanceRegistryHydration.ts";
import type { ProviderInstanceRegistryMutatorShape } from "../provider/Services/ProviderInstanceRegistryMutator.ts";
import type { ProviderRegistryShape } from "../provider/Services/ProviderRegistry.ts";
import type { ServerSettingsService } from "../serverSettings.ts";
import { instanceUsesSavedCredential, subscriptionProviderSettingsPatch } from "./runtime.ts";
import type { SubscriptionAuthService, SubscriptionProviderId } from "./service.ts";

const providersByDriver = {
  codex: "openai-codex",
  claudeAgent: "anthropic",
  grok: "xai",
  kimi: "kimi-for-coding",
  opencodeGo: "opencode-go",
} satisfies Readonly<Record<string, SubscriptionProviderId>>;

export function subscriptionProviderMutation(
  auth: SubscriptionAuthService,
  settings: ServerSettingsService["Service"],
  mutator: ProviderInstanceRegistryMutatorShape,
  registry: Pick<ProviderRegistryShape, "refreshInstance">,
) {
  return Effect.fn("subscriptionAuth.refreshChangedProviders")(function* <
    Value,
    Error,
    Environment,
  >(operation: Effect.Effect<Value, Error, Environment>) {
    const beforeSettings = yield* settings.getSettings.pipe(
      subscriptionAuthFailure("Could not read the server settings."),
    );

    const bindings = Object.entries(deriveProviderInstanceConfigMap(beforeSettings)).flatMap(
      ([instanceId, instance]) => {
        const provider = Object.entries(providersByDriver).find(
          ([driver]) => driver === instance.driver,
        )?.[1];

        if (!provider || !instanceUsesSavedCredential(provider, instance)) return [];

        return [
          {
            provider,
            instanceId: ProviderInstanceId.make(instanceId),
            credential:
              auth.getOAuthCredential(provider, instanceId) ??
              auth.getApiKeyCredential(provider, instanceId),
          },
        ];
      },
    );

    const result = yield* operation;

    const changed = bindings.filter(({ provider, instanceId, credential }) => {
      const current =
        auth.getOAuthCredential(provider, instanceId) ??
        auth.getApiKeyCredential(provider, instanceId);

      return credential?.type !== current?.type || credential?.access !== current?.access;
    });

    if (changed.length === 0) return result;

    const currentSettings = yield* settings.getSettings.pipe(
      subscriptionAuthFailure("Could not read the server settings."),
    );

    const patch = subscriptionProviderSettingsPatch(currentSettings, auth.statuses());

    const nextSettings = patch
      ? yield* settings
          .updateSettings(patch)
          .pipe(subscriptionAuthFailure("Could not save the server settings."))
      : currentSettings;

    yield* mutator.reconcile(deriveProviderInstanceConfigMap(nextSettings));
    yield* Effect.forEach(changed, ({ instanceId }) => registry.refreshInstance(instanceId), {
      discard: true,
    });

    return result;
  });
}
