import {
  BotId,
  CommandId,
  GroupId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { isSameSpaceHandoff, isSameSpaceHandoffInSnapshot } from "./IsnadiDelegationPolicy.ts";
import {
  applyCommand,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
  NOW,
} from "../../orchestration/test-support/GroupDeciderFixtures.ts";

const HOME = GroupId.make("group-home");

const OTHER_HOME = GroupId.make("group-other");

const ACTING = BotId.make("bot-acting");

const TARGET = BotId.make("bot-target");

/**
 * A handoff inside one space skips the approval; anything else keeps it. The
 * cases below pin the anchor — the home each bot was hired into — and the two
 * ways absence has to fail closed.
 */
it.layer(NodeServices.layer)("same-space handoff", (it) => {
  it("allows a handoff between two bots hired into one home", () => {
    expect(
      isSameSpaceHandoff({ threadGroupId: HOME, actingBotHome: HOME, targetBotHome: HOME }),
    ).toBe(true);
  });

  it("refuses a target hired into another home", () => {
    expect(
      isSameSpaceHandoff({ threadGroupId: HOME, actingBotHome: HOME, targetBotHome: OTHER_HOME }),
    ).toBe(false);
  });

  it("refuses a direct chat, which belongs to one bot and not the environment", () => {
    expect(
      isSameSpaceHandoff({ threadGroupId: null, actingBotHome: HOME, targetBotHome: HOME }),
    ).toBe(false);
  });

  it("refuses when neither bot has a home, even though the homes match", () => {
    expect(
      isSameSpaceHandoff({ threadGroupId: HOME, actingBotHome: null, targetBotHome: null }),
    ).toBe(false);
  });

  /**
   * A roster is not a space. `CreateChannel` lets a bot write a group whose
   * members it chooses, so a bot can put itself and any target in one roster
   * without the user asking. Running the real `group.create` through the
   * decider and projector shows what that buys: a roster naming both bots, and
   * no change to either home. The predicate reads that as a crossing, which is
   * the only thing this case establishes — a roster cannot stand in for a home.
   */
  it.effect("reads a bot-authored channel roster as a crossing", () =>
    Effect.gen(function* () {
      const forgedChannel = GroupId.make("channel-created-by-the-acting-bot");

      const thread = {
        ...makeGroupThread(),
        id: ThreadId.make("thread-forged"),
        groupId: forgedChannel,
      };

      const before = makeReadModel({
        bots: [
          makeBot({ id: ACTING, groupId: HOME }),
          makeBot({ id: TARGET, groupId: OTHER_HOME }),
        ],
        groups: [makeGroup()],
        threads: [thread],
      });

      const command: OrchestrationCommand = {
        type: "group.create",
        commandId: CommandId.make("cmd-forged-channel"),
        groupId: forgedChannel,
        name: "Forged channel",
        bossBotId: ACTING,
        specialistBotIds: [TARGET],
        createdAt: NOW,
      };

      const { readModel, events } = yield* applyCommand(before, command);

      // The roster the bot authored names both bots, which is the whole attack.
      const channel = readModel.groups.find((group) => group.id === forgedChannel);

      expect(channel?.members).toEqual([
        { kind: "bot", botId: ACTING, role: "boss" },
        { kind: "bot", botId: TARGET, role: "specialist" },
      ]);

      // It wrote no home: the only event is the group itself.
      expect(events.map((event) => event.type)).toEqual(["group.created"]);
      expect(homeOf(readModel, ACTING)).toBe(HOME);
      expect(homeOf(readModel, TARGET)).toBe(OTHER_HOME);

      // So the handoff in that channel still crosses, and keeps its approval.
      expect(
        isSameSpaceHandoffInSnapshot(readModel, {
          threadId: thread.id,
          actingBotId: ACTING,
          targetBotId: TARGET,
        }),
      ).toBe(false);
    }),
  );

  it("reads a handoff in the thread's own group between two bots sharing a home as one space", () => {
    const readModel = makeReadModel({
      bots: [makeBot({ id: ACTING, groupId: HOME }), makeBot({ id: TARGET, groupId: HOME })],
      groups: [makeGroup()],
      threads: [makeGroupThread()],
    });

    expect(
      isSameSpaceHandoffInSnapshot(readModel, {
        threadId: ThreadId.make("thread-group"),
        actingBotId: ACTING,
        targetBotId: TARGET,
      }),
    ).toBe(true);
  });

  it("fails closed when the snapshot does not know the thread", () => {
    const readModel = makeReadModel({
      bots: [makeBot({ id: ACTING, groupId: HOME }), makeBot({ id: TARGET, groupId: HOME })],
      groups: [makeGroup()],
      threads: [],
    });

    expect(
      isSameSpaceHandoffInSnapshot(readModel, {
        threadId: ThreadId.make("thread-missing"),
        actingBotId: ACTING,
        targetBotId: TARGET,
      }),
    ).toBe(false);
  });

  /**
   * A bot addresses a squad mate by name, not by ID: `TargetBotId` is "bot id
   * or exact name". The cases below pin that the space is decided on the bot
   * the name resolves to, so the natural way to address a mate takes the same
   * path as an ID would — and that every way resolution can fail keeps the
   * approval instead of quietly dropping it.
   */
  describe("a target addressed by name", () => {
    const NAMED_TARGET = BotId.make("Squad Mate");

    /**
     * The thread's group names every bot in the model, so each is reachable by
     * name: what separates these cases is the home, not the roster.
     */
    const readModel = (input: {
      readonly targetHome: GroupId | null;
      readonly extraBots?: ReadonlyArray<OrchestrationReadModel["bots"][number]>;
    }) => {
      const bots = [
        { ...makeBot({ id: ACTING, groupId: HOME }), name: "Planner" },
        { ...makeBot({ id: TARGET, groupId: input.targetHome }), name: "Squad Mate" },
        ...(input.extraBots ?? []),
      ];

      return makeReadModel({
        bots,
        groups: [
          makeGroup({
            members: bots.map((bot) => ({
              kind: "bot" as const,
              botId: bot.id,
              role: bot.id === ACTING ? ("boss" as const) : ("specialist" as const),
            })),
          }),
        ],
        threads: [makeGroupThread()],
      });
    };

    it("reads a named squad mate in the same space as an internal move", () => {
      expect(
        isSameSpaceHandoffInSnapshot(readModel({ targetHome: HOME }), {
          threadId: ThreadId.make("thread-group"),
          actingBotId: ACTING,
          targetBotId: NAMED_TARGET,
        }),
      ).toBe(true);
    });

    it("keeps the approval for a named target hired into another space", () => {
      expect(
        isSameSpaceHandoffInSnapshot(readModel({ targetHome: OTHER_HOME }), {
          threadId: ThreadId.make("thread-group"),
          actingBotId: ACTING,
          targetBotId: NAMED_TARGET,
        }),
      ).toBe(false);
    });

    it("keeps the approval when the name matches more than one bot", () => {
      const twin = {
        ...makeBot({ id: BotId.make("bot-twin"), groupId: HOME }),
        name: "Squad Mate",
      };

      expect(
        isSameSpaceHandoffInSnapshot(readModel({ targetHome: HOME, extraBots: [twin] }), {
          threadId: ThreadId.make("thread-group"),
          actingBotId: ACTING,
          targetBotId: NAMED_TARGET,
        }),
      ).toBe(false);
    });

    it("keeps the approval when the name matches no bot", () => {
      expect(
        isSameSpaceHandoffInSnapshot(readModel({ targetHome: HOME }), {
          threadId: ThreadId.make("thread-group"),
          actingBotId: ACTING,
          targetBotId: BotId.make("Nobody Here"),
        }),
      ).toBe(false);
    });
  });
});

function homeOf(readModel: OrchestrationReadModel, botId: BotId) {
  return readModel.bots.find((bot) => bot.id === botId)?.groupId ?? null;
}
