import {
  AuthSessionId,
  BotId,
  CommandId,
  GroupId,
  WorkItemId,
  type ClientWorkItemCommand,
  type OrchestrationCommand,
  type OrchestrationGroup,
  type WorkItem,
  type WorkItemBlockedOn,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { decideOrchestrationCommand } from "./decider.ts";
import {
  makeReadModel,
  makeBot,
  makeGroup,
  makeGroupThread,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  PERSON_ID,
  GROUP_ID,
  NOW,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * The authorization matrix for every E13 command a client can dispatch: each one
 * is decided twice, once as a person session and once — where the family has one
 * — as a bot actor, so a hole cannot open in one path while the other stays
 * green. The bot identity a client might try to claim is covered at the contract
 * boundary in `packages/contracts/src/orchestration.e13Auth.test.ts`.
 */

const OUTSIDER_ID = AuthSessionId.make("person-outsider");

/** A second group, so "another group's boss" is a real bot with a real role. */
const OTHER_GROUP_ID = GroupId.make("group-ops");

const OTHER_BOSS_ID = BotId.make("bot-ops-boss");

const ITEM_ID = WorkItemId.make("item-1");

type Actor = { readonly personId: AuthSessionId; readonly canManageGroups: boolean };

const MEMBER: Actor = { personId: PERSON_ID, canManageGroups: false };

const OUTSIDER: Actor = { personId: OUTSIDER_ID, canManageGroups: false };

/** An outsider that holds the owner's manage right: the second privilege path. */
const MANAGER: Actor = { personId: OUTSIDER_ID, canManageGroups: true };

const makeOtherGroup = (): OrchestrationGroup => ({
  id: OTHER_GROUP_ID,
  name: "Ops",
  bossBotId: OTHER_BOSS_ID,
  fleetTemplateId: null,
  members: [{ kind: "bot", botId: OTHER_BOSS_ID, role: "boss" }],
  createdAt: NOW,
  updatedAt: NOW,
});

const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: ITEM_ID,
  groupId: GROUP_ID,
  title: "Fix the thing",
  brief: "It is broken.",
  kind: "task",
  state: "queued",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const makeModel = (items: ReadonlyArray<WorkItem>) => ({
  ...makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
      makeBot({ id: OTHER_BOSS_ID, groupId: OTHER_GROUP_ID }),
      makeBot({ id: OTHER_SPECIALIST_ID }),
    ],
    groups: [makeGroup(), makeOtherGroup()],
    threads: [makeGroupThread()],
  }),
  workItems: items,
});

const decide = (
  command: OrchestrationCommand,
  items: ReadonlyArray<WorkItem> = [],
  actor?: Actor,
) =>
  decideOrchestrationCommand({
    command,
    readModel: makeModel(items),
    ...(actor !== undefined ? { actor } : {}),
  }).pipe(Effect.map((result) => (Array.isArray(result) ? result : [result])));

const isAllowed = <E, R>(effect: Effect.Effect<unknown, E, R>) =>
  Effect.map(Effect.exit(effect), Exit.isSuccess);

/** The server-built wrapper: the bot id is stamped by the server, never by a client. */
const botAct = (actorBotId: BotId, command: ClientWorkItemCommand): OrchestrationCommand => ({
  type: "work-item.bot-act",
  commandId: CommandId.make(`cmd-bot-act-${command.commandId}`),
  actorBotId,
  command,
  createdAt: NOW,
});

const BLOCKED_ON: WorkItemBlockedOn = { by: "user", note: "waiting on a review" };

const botItemCommand = (type: ClientWorkItemCommand["type"]): ClientWorkItemCommand => {
  const base = { commandId: CommandId.make(`cmd-${type}`), workItemId: ITEM_ID };

  switch (type) {
    case "work-item.create":
      return {
        type,
        commandId: base.commandId,
        workItemId: ITEM_ID,
        groupId: GROUP_ID,
        title: "Fix the thing",
        brief: "It is broken.",
        kind: "task",
      };
    case "work-item.assign":
      return { type, ...base, ownerBotId: SPECIALIST_ID };
    case "work-item.update":
      return { type, ...base, title: "Renamed" };
    case "work-item.close":
      return { type, ...base, resolution: "done" };
    case "work-item.reopen":
      return { type, ...base };
    case "work-item.block":
      return { type, ...base, blockedOn: BLOCKED_ON };
    case "work-item.unblock":
      return { type, ...base };
    default:
      throw new Error(`unhandled work-item command '${type}'`);
  }
};

/** One decision per work-item command, against the state that command accepts. */
const personCases: ReadonlyArray<{
  readonly label: string;
  readonly items: ReadonlyArray<WorkItem>;
  readonly command: (commandId: string) => ClientWorkItemCommand;
}> = [
  {
    label: "create",
    items: [],
    command: (commandId) => ({
      ...botItemCommand("work-item.create"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "assign",
    items: [makeItem()],
    command: (commandId) => ({
      ...botItemCommand("work-item.assign"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "update",
    items: [makeItem({ state: "assigned", ownerBotId: SPECIALIST_ID })],
    command: (commandId) => ({
      ...botItemCommand("work-item.update"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "block",
    items: [makeItem({ state: "assigned", ownerBotId: SPECIALIST_ID })],
    command: (commandId) => ({
      ...botItemCommand("work-item.block"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "unblock",
    items: [
      makeItem({
        state: "blocked",
        blockedFrom: "assigned",
        blockedOn: BLOCKED_ON,
        ownerBotId: SPECIALIST_ID,
      }),
    ],
    command: (commandId) => ({
      ...botItemCommand("work-item.unblock"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "close",
    items: [makeItem({ state: "review", ownerBotId: SPECIALIST_ID })],
    command: (commandId) => ({
      ...botItemCommand("work-item.close"),
      commandId: CommandId.make(commandId),
    }),
  },
  {
    label: "reopen",
    items: [makeItem({ state: "done", doneAt: NOW })],
    command: (commandId) => ({
      ...botItemCommand("work-item.reopen"),
      commandId: CommandId.make(commandId),
    }),
  },
];

it.layer(NodeServices.layer)("E13 command authorization", (it) => {
  it.effect(
    "decides every client work-item command for a member and refuses it for a stranger",
    () =>
      Effect.forEach(personCases, (testCase) =>
        Effect.gen(function* () {
          const command = testCase.command(`cmd-member-${testCase.label}`);
          const member = yield* isAllowed(decide(command, testCase.items, MEMBER));
          const outsider = yield* isAllowed(decide(command, testCase.items, OUTSIDER));

          expect(member, `${testCase.label}: a group member must be allowed`).toBe(true);
          expect(outsider, `${testCase.label}: a stranger must be refused`).toBe(false);
        }),
      ),
  );

  it.effect(
    "lets the owner's manage right stand in for membership on every work-item command",
    () =>
      Effect.forEach(personCases, (testCase) =>
        Effect.gen(function* () {
          const allowed = yield* isAllowed(
            decide(testCase.command(`cmd-manager-${testCase.label}`), testCase.items, MANAGER),
          );

          expect(allowed, `${testCase.label}: a manager must be allowed`).toBe(true);
        }),
      ),
  );

  it.effect("treats an absent actor as the server acting as the owner", () =>
    // Reactors and cascades dispatch without a person. That is safe only because
    // the two client entry points (`wsServices.ts`, `orchestration/http.ts`) build
    // an actor from the authenticated session for every client command; a path
    // that lets a client reach the decider without one would be a hole here.
    Effect.forEach(personCases, (testCase) =>
      Effect.gen(function* () {
        const allowed = yield* isAllowed(
          decide(testCase.command(`cmd-no-actor-${testCase.label}`), testCase.items),
        );

        expect(allowed, `${testCase.label}: an absent actor is the owner`).toBe(true);
      }),
    ),
  );

  it.effect("lets the group's boss bot run the commands a real fleet hire and standup need", () =>
    Effect.gen(function* () {
      expect(
        yield* isAllowed(decide(botAct(BOSS_ID, botItemCommand("work-item.create")), [], OUTSIDER)),
      ).toBe(true);
      expect(
        yield* isAllowed(
          decide(botAct(BOSS_ID, botItemCommand("work-item.assign")), [makeItem()], OUTSIDER),
        ),
      ).toBe(true);
      expect(
        yield* isAllowed(
          decide(
            botAct(BOSS_ID, botItemCommand("work-item.close")),
            [makeItem({ state: "review", ownerBotId: SPECIALIST_ID })],
            OUTSIDER,
          ),
        ),
      ).toBe(true);
    }),
  );

  it.effect("refuses a bot acting as another group's boss, on every work-item command", () =>
    Effect.forEach(personCases, (testCase) =>
      Effect.gen(function* () {
        const command = botAct(OTHER_BOSS_ID, {
          ...testCase.command(`cmd-cross-group-${testCase.label}`),
        });

        const allowed = yield* isAllowed(decide(command, testCase.items, OUTSIDER));

        expect(
          allowed,
          `${testCase.label}: the boss of ${OTHER_GROUP_ID} must not reach ${GROUP_ID}'s items`,
        ).toBe(false);
      }),
    ),
  );

  it.effect("refuses a bot that is in no group at all", () =>
    Effect.forEach(personCases, (testCase) =>
      Effect.gen(function* () {
        const allowed = yield* isAllowed(
          decide(
            botAct(OTHER_SPECIALIST_ID, testCase.command(`cmd-ungrouped-${testCase.label}`)),
            testCase.items,
            OUTSIDER,
          ),
        );

        expect(allowed, `${testCase.label}: an ungrouped bot must be refused`).toBe(false);
      }),
    ),
  );

  it.effect("keeps a member bot to its own items and to the three commands it may run", () =>
    Effect.gen(function* () {
      const owned = makeItem({ state: "assigned", ownerBotId: SPECIALIST_ID });

      expect(
        yield* isAllowed(
          decide(botAct(SPECIALIST_ID, botItemCommand("work-item.update")), [owned], OUTSIDER),
        ),
      ).toBe(true);

      // A member bot may not hire, assign or close: that is the boss's call.
      for (const bossOnly of ["work-item.create", "work-item.assign", "work-item.close"] as const) {
        const allowed = yield* isAllowed(
          decide(botAct(SPECIALIST_ID, botItemCommand(bossOnly)), [owned], OUTSIDER),
        );

        expect(allowed, `a member bot must not run '${bossOnly}'`).toBe(false);
      }

      // And it may not touch an item somebody else owns.
      const someoneElses = makeItem({ state: "assigned", ownerBotId: OTHER_SPECIALIST_ID });
      expect(
        yield* isAllowed(
          decide(
            botAct(SPECIALIST_ID, botItemCommand("work-item.update")),
            [someoneElses],
            OUTSIDER,
          ),
        ),
      ).toBe(false);
    }),
  );

  it.effect("takes the assignedByBotId from the acting bot, never from the command", () =>
    Effect.gen(function* () {
      const events = yield* decide(
        botAct(BOSS_ID, {
          type: "work-item.assign",
          commandId: CommandId.make("cmd-assign-by-boss"),
          workItemId: ITEM_ID,
          ownerBotId: SPECIALIST_ID,
        }),
        [makeItem()],
        OUTSIDER,
      );

      const payload = events[0]?.payload;

      if (payload === undefined || !("workItem" in payload))
        throw new Error("no work item payload");

      expect(payload.workItem.assignedByBotId).toBe(BOSS_ID);
    }),
  );

  it.effect("refuses a claim from another group's boss and from an ungrouped bot", () =>
    Effect.gen(function* () {
      const claim = (botId: BotId, commandId: string): OrchestrationCommand => ({
        type: "work-item.claim",
        commandId: CommandId.make(commandId),
        botId,
        workItemId: ITEM_ID,
        createdAt: NOW,
      });

      expect(
        yield* isAllowed(decide(claim(SPECIALIST_ID, "cmd-claim-self"), [makeItem()], OUTSIDER)),
      ).toBe(true);
      expect(
        yield* isAllowed(decide(claim(OTHER_BOSS_ID, "cmd-claim-cross"), [makeItem()], OUTSIDER)),
      ).toBe(false);
      expect(
        yield* isAllowed(
          decide(claim(OTHER_SPECIALIST_ID, "cmd-claim-none"), [makeItem()], OUTSIDER),
        ),
      ).toBe(false);
      // Two idle bots reading the same queue cannot both take one item.
      expect(
        yield* isAllowed(
          decide(
            claim(SPECIALIST_ID, "cmd-claim-taken"),
            [makeItem({ state: "assigned", ownerBotId: BOSS_ID })],
            OUTSIDER,
          ),
        ),
      ).toBe(false);
    }),
  );

  it.effect("scopes bot interrupt and bot clear to the thread's group", () =>
    Effect.gen(function* () {
      const interrupt = (commandId: string): OrchestrationCommand => ({
        type: "thread.turn.interrupt",
        commandId: CommandId.make(commandId),
        threadId: makeGroupThread().id,
        createdAt: NOW,
      });

      const stop = (commandId: string): OrchestrationCommand => ({
        type: "thread.session.stop",
        commandId: CommandId.make(commandId),
        threadId: makeGroupThread().id,
        createdAt: NOW,
      });

      for (const [label, command] of [
        ["interrupt", interrupt],
        ["clear", stop],
      ] as const) {
        expect(
          yield* isAllowed(decide(command(`cmd-member-${label}`), [], MEMBER)),
          `${label}: a member must be allowed`,
        ).toBe(true);
        expect(
          yield* isAllowed(decide(command(`cmd-manager-${label}`), [], MANAGER)),
          `${label}: a manager must be allowed`,
        ).toBe(true);
        expect(
          yield* isAllowed(decide(command(`cmd-outsider-${label}`), [], OUTSIDER)),
          `${label}: a stranger must be refused`,
        ).toBe(false);
        expect(
          yield* isAllowed(decide(command(`cmd-no-actor-${label}`), [])),
          `${label}: an absent actor is the owner (reactors dispatch without a person)`,
        ).toBe(true);
      }
    }),
  );
});
