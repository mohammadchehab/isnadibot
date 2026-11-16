import {
  FLEET_ROLES,
  ProviderDriverKind,
  ProviderInstanceId,
  fleetRole,
  type FleetRole,
  type ServerProvider,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roleLibraryRows, roleModelLabel, suggestedBotName } from "./roleLibrary.logic";

const provider = (driver: string, model: string, name: string): ServerProvider => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [{ slug: model, name, isCustom: false, capabilities: null }],
  slashCommands: [],
  skills: [],
});

const scout = (): FleetRole => {
  const role = fleetRole("scout");

  if (role === undefined) throw new Error("the library has no scout");

  return role;
};

describe("roleLibraryRows", () => {
  it("offers the library's own roles, so the picker cannot name a role the engine lacks", () => {
    expect(roleLibraryRows()).toBe(FLEET_ROLES);
  });
});

describe("suggestedBotName", () => {
  it("keeps the role's name while the space is free of it", () => {
    expect(suggestedBotName("Scout", ["Tailor"])).toBe("Scout");
  });

  it("steps past a name the space already answers to, ignoring case", () => {
    expect(suggestedBotName("Scout", ["scout", "Scout 2"])).toBe("Scout 3");
  });
});

describe("roleModelLabel", () => {
  it("names the model the way the connected provider does", () => {
    expect(
      roleModelLabel(scout(), [provider("claudeAgent", "claude-opus-5-5", "Claude Opus")]),
    ).toBe("Claude Opus");
  });

  it("falls back to the library's slug when that provider is not connected", () => {
    expect(roleModelLabel(scout(), [])).toBe("claude-opus-5-5");
  });
});
