import { FLEET_ROLES, type FleetRole, type ServerProvider } from "@isnadi/contracts";

import { getProviderModels } from "../../providerModels";

/**
 * The rows the role-library picker offers, in the library's own order. The
 * dialog is data-driven off `FLEET_ROLES` (decision-118 A), so a role the
 * engine gains becomes a row and a role it drops stops being offered: the
 * picker carries no role name of its own.
 */
export const roleLibraryRows = (): ReadonlyArray<FleetRole> => FLEET_ROLES;

/**
 * The name a bot hired as `roleName` is offered in a space that already uses
 * `takenNames`: the role's own name, then "Scout 2", "Scout 3", the way the
 * frame's placeholder reads once the space has its Scout. Comparison ignores
 * case and surrounding space, because a space's bots are addressed by name.
 */
export function suggestedBotName(roleName: string, takenNames: ReadonlyArray<string>): string {
  const base = roleName.trim();
  const taken = new Set(takenNames.map((name) => name.trim().toLowerCase()));

  if (!taken.has(base.toLowerCase())) return base;

  let suffix = 2;

  while (taken.has(`${base} ${suffix}`.toLowerCase())) suffix += 1;

  return `${base} ${suffix}`;
}

/**
 * The role's default model as its row names it: the connected provider's own
 * label for that model, else the slug the library declares, so a role whose
 * provider is not connected still says which model it asked for.
 */
export function roleModelLabel(role: FleetRole, providers: ReadonlyArray<ServerProvider>): string {
  const models = getProviderModels(providers, role.model.driver);
  const label = models.find((model) => model.slug === role.model.model)?.name.trim();

  return label === undefined || label === "" ? role.model.model : label;
}
