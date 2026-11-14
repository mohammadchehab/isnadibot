import {
  CommandId,
  FLEET_TEMPLATES,
  ProviderInstanceId,
  type FleetRoleId,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";
import { createOrchestrationSystem, asProjectId, now } from "./test-support/OrchestrationSystem.ts";

/**
 * A hire is the one command whose aggregate the client cannot name: the server
 * mints the group during decide. So the dispatch answer is the only place a
 * client learns which squad its command created, and it has to give the same
 * answer again when the same command is retried.
 */

type FleetHire = Extract<OrchestrationCommand, { type: "fleet.hire" }>;

const template = FLEET_TEMPLATES[0];

if (template === undefined) throw new Error("FLEET_TEMPLATES has no template at index 0");

/** One pick per role: `picks` is non-empty by contract, so it is built as one. */
const picksFor = (): FleetHire["picks"] => {
  const [first, ...rest] = template.roleIds.map(
    (roleId: FleetRoleId): FleetHire["picks"][number] => ({
      roleId,
      engine: { provider: "claude", model: "claude-sonnet-5-5", fallbacks: [] },
    }),
  );

  if (first === undefined) throw new Error(`Template '${template.id}' names no usable roles`);

  return [first, ...rest];
};

const picks = picksFor();

const hire = (): FleetHire => ({
  type: "fleet.hire",
  commandId: CommandId.make("cmd-fleet-hire"),
  templateIndex: 0,
  picks,
  createdAt: now(),
});

describe("OrchestrationEngine fleet hire", () => {
  it("answers a hire with the squad it minted, and the same squad on a retry", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    try {
      const first = await system.run(engine.dispatch(hire()));

      expect(first.createdGroupId).toBeDefined();

      const { groups } = await system.readModel();
      const minted = groups.find((group) => group.id === first.createdGroupId);

      expect(minted?.fleetTemplateId).toBe(template.id);

      // The client retries with the command it still holds: same command id,
      // no events committed, and an answer that still names the squad.
      const retried = await system.run(engine.dispatch(hire()));

      expect(retried.createdGroupId).toBe(first.createdGroupId);
      expect(retried.sequence).toBe(first.sequence);
    } finally {
      await system.dispose();
    }
  });

  it("names no group on a command that creates none", async () => {
    const system = await createOrchestrationSystem();
    const { engine } = system;

    try {
      const result = await system.run(
        engine.dispatch({
          type: "project.create",
          commandId: CommandId.make("cmd-project-fleet-hire-answer"),
          projectId: asProjectId("project-fleet-hire-answer"),
          title: "Project",
          workspaceRoot: "/tmp/project-fleet-hire-answer",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          createdAt: now(),
        }),
      );

      expect(result.createdGroupId).toBeUndefined();
    } finally {
      await system.dispose();
    }
  });
});
