import * as Predicate from "effect/Predicate";
import {
  CommandId,
  FLEET_TEMPLATES,
  FleetRoleId,
  GroupId,
  type FleetTemplate,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { decideOrchestrationCommand } from "./decider.ts";
import type {
  DecideOrchestrationCommandResult,
  PlannedOrchestrationEvent,
} from "./decider/eventBase.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  makeReadModel,
  makeBot,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  makeGroup,
  NOW,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * `group.create` was the last way a bot could end up in two workspace groups at
 * once: it accepted a bot whose home was another live group and silently moved
 * it. It now refuses with a closed code. The two paths that legitimately pass a
 * bot already carrying a group id — a fleet hire and a portability import — are
 * pinned here so a tighter check cannot break them.
 */
it.layer(NodeServices.layer)("group.create membership refusals", (it) => {
  const NEW_GROUP_ID = GroupId.make("group-launch-crew");
  const HOME_GROUP_ID = GroupId.make("group-home");

  type GroupCreate = Extract<OrchestrationCommand, { type: "group.create" }>;

  const createGroup = (overrides: Partial<Omit<GroupCreate, "type">> = {}): GroupCreate => ({
    type: "group.create",
    commandId: CommandId.make("cmd-group-create"),
    groupId: NEW_GROUP_ID,
    name: "Launch crew",
    bossBotId: BOSS_ID,
    specialistBotIds: [SPECIALIST_ID],
    createdAt: NOW,
    ...overrides,
  });

  const decide = (command: OrchestrationCommand, readModel: ReturnType<typeof makeReadModel>) =>
    decideOrchestrationCommand({ command, readModel });

  // A decide returns one event or a list; only an event carries `type`.
  const eventsOf = (
    result: DecideOrchestrationCommandResult,
  ): ReadonlyArray<PlannedOrchestrationEvent> => ("type" in result ? [result] : result);

  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  it.effect("refuses a member whose home is another live group", () =>
    Effect.gen(function* () {
      // A failed decide returns no events at all, which is what "plans nothing"
      // means here: the create leaves the roster untouched.
      const error = yield* decide(
        createGroup(),
        makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID, groupId: null }),
            makeBot({ id: SPECIALIST_ID, groupId: HOME_GROUP_ID }),
          ],
          groups: [makeGroup({ id: HOME_GROUP_ID, bossBotId: null, members: [] })],
        }),
      ).pipe(Effect.flip);

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("bot-in-another-group");
      // The prose keeps the ids for a client that does not know the code; the
      // toast shows the coded copy instead, so ids never reach the user.
      expect(detail).toContain("bot-specialist");
      expect(detail).toContain("group-home");
    }),
  );

  it.effect("allows the same bot once its home group is gone", () =>
    Effect.gen(function* () {
      const events = eventsOf(
        yield* decide(
          createGroup(),
          makeReadModel({
            bots: [
              makeBot({ id: BOSS_ID, groupId: null }),
              makeBot({ id: SPECIALIST_ID, groupId: HOME_GROUP_ID }),
            ],
            // No group carries HOME_GROUP_ID: the home was deleted, so this
            // create is the only way to give the bot a live one.
            groups: [],
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual(["group.created"]);
    }),
  );

  it.effect("allows a bot a portability import created with no home", () =>
    Effect.gen(function* () {
      // `portabilityCommands.ts` mints every imported bot with `groupId: null`,
      // and `portability.commands.test.ts` runs a whole restore plan through
      // this decider, so this case is pinned at both levels on purpose.
      const events = eventsOf(
        yield* decide(
          createGroup({ specialistBotIds: [OTHER_SPECIALIST_ID] }),
          makeReadModel({
            bots: [
              makeBot({ id: BOSS_ID, groupId: null }),
              makeBot({ id: OTHER_SPECIALIST_ID, groupId: null }),
            ],
            groups: [],
          }),
        ),
      );

      expect(events.map((event) => event.type)).toEqual(["group.created"]);
    }),
  );

  it.effect("lets a fleet hire through: its bots carry the group being created", () =>
    Effect.gen(function* () {
      const template: FleetTemplate | undefined = FLEET_TEMPLATES[0];

      if (template === undefined) throw new Error("FLEET_TEMPLATES has no template at index 0");

      // `picks` is a non-empty array by contract, so it is built as one.
      const [firstPick, ...restPicks] = template.roleIds.map((roleId: FleetRoleId) => ({
        roleId,
        engine: { provider: "claude", model: "claude-sonnet-5-5", fallbacks: [] },
      }));

      if (firstPick === undefined) throw new Error("The template names no usable roles");

      const events = eventsOf(
        yield* decide(
          {
            type: "fleet.hire",
            commandId: CommandId.make("cmd-fleet-hire"),
            templateIndex: 0,
            picks: [firstPick, ...restPicks],
            createdAt: NOW,
          },
          makeReadModel({}),
        ),
      );

      const createdGroup = events.find((event) => event.type === "group.created");

      if (createdGroup === undefined) throw new Error("Expected group.created");

      const bots = events.filter((event) => event.type === "bot.created");

      expect(bots).toHaveLength(template.roleIds.length);

      // A hire mints its bots with the group's id before the group exists, so
      // the check has to compare `command.groupId` and the live roster rather
      // than the bot's home alone.
      for (const bot of bots) {
        expect(bot.payload).toMatchObject({ groupId: createdGroup.aggregateId });
      }
    }),
  );
});
