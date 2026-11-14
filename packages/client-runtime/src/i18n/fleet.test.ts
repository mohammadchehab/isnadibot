import { describe, expect, it } from "vite-plus/test";

import { FLEET_ROLES, FLEET_TEMPLATES } from "@isnadi/contracts";

import { englishCatalog } from "./index.ts";

// The contracts carry the English copy and the screens translate it by that exact string.
const fleetLabels = [
  ...FLEET_TEMPLATES.flatMap((template) => [template.name, template.description]),
  ...FLEET_ROLES.flatMap((role) => [role.name, role.description]),
];

describe("fleet templates and roles", () => {
  it("name and describe every card through the English catalog", () => {
    const missing = fleetLabels.filter((label) => !Object.hasOwn(englishCatalog, label));

    expect(missing).toEqual([]);
  });
});
