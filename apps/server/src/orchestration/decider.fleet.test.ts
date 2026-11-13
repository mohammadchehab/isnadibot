import {
  AuthSessionId,
  BotId,
  CommandId,
  FLEET_TEMPLATES,
  FleetRoleId,
  FleetTemplateId,
  GroupId,
  type FleetTemplate,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { decideOrchestrationCommand } from "./decider.ts";
import { makeReadModel, NOW } from "./test-support/GroupDeciderFixtures.ts";

/**
 * Hiring is one command that must land as a unit: either every member and the
 * group exist, or nothing does. These tests pin that, plus the two authority
 * edges — a plain member may not hire, and a template id a client invents is
 * refused at `group.create` too, not only at `fleet.hire`.
 */

const TEMPLATE_INDEX = 0;

type FleetHire = Extract<OrchestrationCommand, { type: "fleet.hire" }>;

type FleetPick = FleetHire["picks"][number];

const recruiting = (): FleetTemplate => {
  const found = FLEET_TEMPLATES[TEMPLATE_INDEX];

  if (found === undefined) throw new Error("FLEET_TEMPLATES has no template at index 0");

  return found;
};

/** One pick per role. `picks` is a non-empty array by contract, so it is built as one. */
const picksFor = (template: FleetTemplate, skipRoleId?: FleetRoleId): FleetHire["picks"] => {
  const [first, ...rest] = template.roleIds.flatMap((roleId: FleetRoleId): [] | [FleetPick] =>
    roleId === skipRoleId
      ? []
      : [
          {
            roleId,
            engine: { provider: "claude", model: "claude-sonnet-5-5", fallbacks: [] },
          },
        ],
  );

  if (first === undefined) throw new Error(`Template '${template.id}' names no usable roles`);

  return [first, ...rest];
};

const hire = (overrides: Partial<Omit<FleetHire, "type">> = {}): FleetHire => ({
  type: "fleet.hire",
  commandId: CommandId.make("cmd-fleet-hire"),
  templateIndex: TEMPLATE_INDEX,
  picks: picksFor(recruiting()),
  createdAt: NOW,
  ...overrides,
});

const decide = (command: OrchestrationCommand, canManageGroups?: boolean) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({
      command,
      readModel: makeReadModel({}),
      ...(canManageGroups === undefined
        ? {}
        : { actor: { personId: AuthSessionId.make("person-1"), canManageGroups } }),
    });

    return Array.isArray(result) ? result : [result];
  });

const fails = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => expect(Exit.isFailure(exit)).toBe(true));

const succeeded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.flatMap(Effect.exit(effect), (exit) =>
    Exit.isSuccess(exit)
      ? Effect.succeed(exit.value)
      : Effect.die(new Error(`expected the command to be accepted: ${Cause.pretty(exit.cause)}`)),
  );

it.layer(NodeServices.layer)("fleet hire decider", (it) => {
  it.effect("one hire creates every member and the group on one commandId", () =>
    Effect.gen(function* () {
      const template = recruiting();
      const events = yield* succeeded(decide(hire()));

      const created = events.filter((event) => event.type === "bot.created");
      const groups = events.filter((event) => event.type === "group.created");

      expect(created).toHaveLength(template.roleIds.length);
      expect(groups).toHaveLength(1);

      // One receipt: every event carries the one commandId the client sent.
      for (const event of events) {
        expect(event.commandId).toBe(CommandId.make("cmd-fleet-hire"));
      }

      expect(groups[0]?.payload).toMatchObject({
        fleetTemplateId: template.id,
        keepBusy: true,
        name: template.name,
      });

      const groupId = groups[0]?.aggregateId;

      // The roster groups bots by `bot.groupId`, so every hired member has to
      // carry the group's id, and the group has to name every one of them.
      for (const event of created) {
        expect(event.payload).toMatchObject({ groupId });
      }

      expect(groups[0]?.payload).toMatchObject({
        members: expect.arrayContaining(
          created.map((event) =>
            expect.objectContaining({ kind: "bot", botId: event.aggregateId }),
          ),
        ),
      });
    }),
  );

  it.effect("a role without a pick refuses the whole hire and writes nothing", () =>
    Effect.gen(function* () {
      const template = recruiting();
      const picks = picksFor(template, template.bossRoleId);

      yield* fails(decide(hire({ picks })));
    }),
  );

  it.effect("an unknown template index is refused", () =>
    fails(decide(hire({ templateIndex: FLEET_TEMPLATES.length + 3 }))),
  );

  it.effect("a boss role the template does not have is refused", () =>
    fails(decide(hire({ bossRoleId: FleetRoleId.make("coach-not-in-template") }))),
  );

  it.effect("a plain member may not hire, a group manager may, an internal dispatch may", () =>
    Effect.gen(function* () {
      yield* fails(decide(hire(), false));

      const allowed = yield* succeeded(decide(hire(), true));
      expect(allowed.length).toBeGreaterThan(0);

      const internal = yield* succeeded(decide(hire()));
      expect(internal.length).toBe(allowed.length);
    }),
  );

  it.effect("a group naming a template that does not exist is refused", () =>
    fails(
      decide({
        type: "group.create",
        commandId: CommandId.make("cmd-group-create"),
        groupId: GroupId.make("group-x"),
        name: "Squad",
        bossBotId: BotId.make("bot-boss"),
        specialistBotIds: [],
        keepBusy: true,
        fleetTemplateId: FleetTemplateId.make("not-a-template"),
        createdAt: NOW,
      }),
    ),
  );
});
