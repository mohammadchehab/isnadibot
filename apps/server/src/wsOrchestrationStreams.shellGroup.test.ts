import { describe, expect, it } from "@effect/vitest";
import { BotId, FleetTemplateId, GroupId, IsoDateTime } from "@isnadi/contracts";

import type { ProjectionGroup } from "./persistence/Services/ProjectionGroups.ts";

import { toShellGroup } from "./wsOrchestrationStreams.ts";

const GROUP_ID = GroupId.make("group-ops");

const BOSS_ID = BotId.make("bot-boss");

const projected = (overrides: Partial<ProjectionGroup> = {}): ProjectionGroup => ({
  groupId: GROUP_ID,
  name: "Ops",
  bossBotId: BOSS_ID,
  members: [{ kind: "bot", botId: BOSS_ID, role: "boss" }],
  hopBudget: null,
  keepBusy: false,
  fleetTemplateId: FleetTemplateId.make("fleet-ops"),
  createdByBotId: null,
  createdAt: IsoDateTime.make("2026-11-16T06:00:00.000Z"),
  updatedAt: IsoDateTime.make("2026-11-16T06:00:00.000Z"),
  ...overrides,
});

describe("the group the shell stream hands the client", () => {
  // The client replaces its whole group with this object, so a field left out of the
  // mapping is a field the UI loses on the next roster event. The keep-busy switch read
  // back as off for exactly that reason: the server stored the flag and never sent it.
  it("carries keep busy, so the switch can read back what the server stored", () => {
    expect(toShellGroup(projected({ keepBusy: true })).keepBusy).toBe(true);
    expect(toShellGroup(projected({ keepBusy: false })).keepBusy).toBe(false);
  });

  it("carries every other field the group holds", () => {
    const group = toShellGroup(projected({ keepBusy: true }));

    expect(group.id).toBe(GROUP_ID);
    expect(group.name).toBe("Ops");
    expect(group.bossBotId).toBe(BOSS_ID);
    expect(group.members).toEqual([{ kind: "bot", botId: BOSS_ID, role: "boss" }]);
    expect(group.fleetTemplateId).toBe(FleetTemplateId.make("fleet-ops"));
    expect(group.createdAt).toBe("2026-11-16T06:00:00.000Z");
  });
});
