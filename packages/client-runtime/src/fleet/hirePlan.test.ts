import { describe, expect, it } from "vite-plus/test";

import {
  FLEET_TEMPLATES,
  ProviderDriverKind,
  ProviderInstanceId,
  type BotEngine,
  type FleetRoleId,
  type FleetTemplate,
  type ServerProvider,
} from "@isnadi/contracts";

import { planFleetHire } from "./hirePlan.ts";

const template = FLEET_TEMPLATES.find(
  (candidate) => candidate.id === "recruiting",
) as FleetTemplate;

/** One ready Claude instance offering the sonnet the template's roles name. */
function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude-1"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-06T00:00:00.000Z",
    models: [
      {
        slug: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        isCustom: false,
        isDefault: true,
        capabilities: null,
      },
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const engineFor = (providerId: string, model: string): BotEngine => ({
  provider: providerId,
  model,
  fallbacks: [],
});

describe("planFleetHire", () => {
  it("lists the template's members boss first, then card order", () => {
    const plan = planFleetHire({ template, providers: [provider()] });

    expect(plan.templateId).toBe(template.id);
    expect(plan.bossRoleId).toBe(template.bossRoleId);
    expect(plan.members[0]?.roleId).toBe(template.bossRoleId);
    expect(plan.members[0]?.isBoss).toBe(true);
    expect(plan.members.map((member) => member.roleId)).toEqual([
      template.bossRoleId,
      ...template.roleIds.filter((roleId) => roleId !== template.bossRoleId),
    ]);
    expect(plan.members.filter((member) => member.isBoss)).toHaveLength(1);
  });

  it("names each member after its role until the user types a name", () => {
    const plan = planFleetHire({
      template,
      providers: [provider()],
      names: new Map<string, string>([["tracker", "Sam"]]),
    });

    expect(plan.members.find((member) => member.roleId === "tracker")?.name).toBe("Sam");
    expect(plan.members.find((member) => member.roleId === "scout")?.name).toBe("Scout");
  });

  it("takes the engine squad setup picked over the role's own", () => {
    const picked = engineFor("codex-1", "gpt-5.5");

    const plan = planFleetHire({
      template,
      providers: [provider()],
      picks: [{ roleId: "scout" as FleetRoleId, engine: picked }],
    });

    expect(plan.members.find((member) => member.roleId === "scout")?.engine).toEqual(picked);
    expect(plan.blockers).toEqual([]);
  });

  it("falls back to the seeded engine when no pick was made", () => {
    const plan = planFleetHire({ template, providers: [provider()] });

    expect(plan.members[0]?.engine?.provider).toBe("claude-1");
    expect(plan.members[0]?.engine?.model).toBe("claude-sonnet-5-5");
  });

  it("starts every role's skills on", () => {
    const plan = planFleetHire({ template, providers: [provider()] });
    const scout = plan.members.find((member) => member.roleId === "scout");

    expect(scout).toBeDefined();
    expect(scout?.skills.every((skill) => skill.enabled)).toBe(true);
  });

  it("blocks the hire when no provider can run a role", () => {
    const plan = planFleetHire({ template, providers: [] });

    expect(plan.blockers.filter((blocker) => blocker.kind === "no-provider")).toHaveLength(
      plan.members.length,
    );
    expect(plan.members.every((member) => member.engine === null)).toBe(true);
  });

  it("blocks two members that share a name, ignoring case and spacing", () => {
    const plan = planFleetHire({
      template,
      providers: [provider()],
      names: new Map<string, string>([
        ["tracker", "Alex"],
        ["coach", " alex "],
      ]),
    });

    expect(plan.blockers).toEqual([{ kind: "duplicate-name", names: ["alex"] }]);
  });

  it("blocks an emptied name", () => {
    const plan = planFleetHire({
      template,
      providers: [provider()],
      names: new Map<string, string>([["scout", "   "]]),
    });

    expect(plan.blockers).toEqual([{ kind: "empty-name", roleId: "scout" }]);
  });
});
