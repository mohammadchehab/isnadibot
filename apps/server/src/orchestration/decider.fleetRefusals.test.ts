import {
  ClientOrchestrationCommand,
  CommandId,
  FLEET_TEMPLATES,
  FleetRoleId,
  type FleetTemplate,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import { Schema } from "effect";
import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import { makeReadModel, NOW } from "./test-support/GroupDeciderFixtures.ts";

/**
 * `fleet.hire` used to refuse with a sentence that printed role ids and the raw
 * blocker enum. Each throw now carries a closed code, so a client that knows it
 * shows its own sentence instead of the server's prose.
 *
 * Every case below first decodes the command against `ClientOrchestrationCommand`
 * and requires that to succeed, so a row cannot claim a client can reach it
 * without the wire schema agreeing. The one exception says so and proves the
 * opposite: an empty name is refused by the schema itself.
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
      : [{ roleId, engine: { provider: "claude", model: "claude-sonnet-5-5", fallbacks: [] } }],
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

const decodeClientCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);

/** Decodes the way the server decodes a client's command; throws if no client could send it. */
const asClientCommand = (command: OrchestrationCommand) => decodeClientCommand(command);

/** The first two roles that are not the boss, for the duplicate-name cases. */
const twoNonBossRoles = (template: FleetTemplate): readonly [FleetRoleId, FleetRoleId] => {
  const [first, second] = template.roleIds.filter((roleId) => roleId !== template.bossRoleId);

  if (first === undefined || second === undefined) {
    throw new Error(`Template '${template.id}' names fewer than two non-boss roles`);
  }

  return [first, second];
};

it.layer(NodeServices.layer)("fleet.hire refusals", (it) => {
  const decide = (command: OrchestrationCommand) =>
    decideOrchestrationCommand({ command, readModel: makeReadModel({}) }).pipe(Effect.flip);

  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  it.effect("an unknown template index names the template half of the version-skew family", () =>
    Effect.gen(function* () {
      // The index is a non-negative int rather than a closed set, so a client
      // built against a newer catalogue can send one this build does not ship.
      const command = hire({ templateIndex: FLEET_TEMPLATES.length + 3 });

      asClientCommand(command);

      const { refusal } = refusalOf(yield* decide(command));

      expect(refusal).toBe("unknown-fleet-template");
    }),
  );

  it.effect("a boss role the template does not have names the role half", () =>
    Effect.gen(function* () {
      const command = hire({ bossRoleId: FleetRoleId.make("coach-not-in-template") });

      asClientCommand(command);

      const { refusal, detail } = refusalOf(yield* decide(command));

      expect(refusal).toBe("unknown-fleet-role");
      // The prose keeps the ids for a client that does not know the code; the
      // toast shows the coded copy instead, so ids never reach the user.
      expect(detail).toContain("coach-not-in-template");
    }),
  );

  it.effect("a role with no engine refuses with the no-provider code", () =>
    Effect.gen(function* () {
      // The decider cannot see the environment's providers, so a role without a
      // pick has no engine and blocks the whole hire.
      const command = hire({ picks: picksFor(recruiting(), recruiting().bossRoleId) });

      asClientCommand(command);

      const { refusal } = refusalOf(yield* decide(command));

      expect(refusal).toBe("fleet-role-has-no-provider");
    }),
  );

  it.effect("two roles given one name refuse with the shared-name code", () =>
    Effect.gen(function* () {
      const [first, second] = twoNonBossRoles(recruiting());

      const command = hire({
        names: [
          { roleId: first, name: "alex" },
          { roleId: second, name: "alex" },
        ],
      });

      asClientCommand(command);

      const { refusal } = refusalOf(yield* decide(command));

      expect(refusal).toBe("fleet-roles-share-name");
    }),
  );

  it.effect("refuses with the first blocker, the one squad setup already named", () =>
    Effect.gen(function* () {
      const [first, second] = twoNonBossRoles(recruiting());
      const template = recruiting();

      // The boss is the plan's first member, so its missing engine is blocker
      // one and the duplicate name is blocker two. Squad setup names the first
      // in its footer and lists the rest behind it, so the refusal has to agree
      // with the row the user was already looking at.
      const command = hire({
        picks: picksFor(template, template.bossRoleId),
        names: [
          { roleId: first, name: "alex" },
          { roleId: second, name: "alex" },
        ],
      });

      asClientCommand(command);

      const { refusal } = refusalOf(yield* decide(command));

      expect(refusal).toBe("fleet-role-has-no-provider");
    }),
  );

  it.effect("maps an empty name even though the wire schema refuses to carry one", () =>
    Effect.gen(function* () {
      const [first] = twoNonBossRoles(recruiting());

      const command = hire({ names: [{ roleId: first, name: "" }] });

      // `FleetHireName.name` is `TrimmedNonEmptyString`, so this command never
      // crosses the wire. The mapping is pinned for totality — the blocker
      // union has three kinds and a client-side plan can hold an empty draft —
      // not because a client can reach it today.
      expect(() => asClientCommand(command)).toThrow();

      const { refusal } = refusalOf(yield* decide(command));

      expect(refusal).toBe("fleet-role-needs-name");
    }),
  );
});
