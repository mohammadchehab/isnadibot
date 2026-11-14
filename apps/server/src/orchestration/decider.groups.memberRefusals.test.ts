import * as Predicate from "effect/Predicate";
import { BotId, CommandId, GroupId, type OrchestrationCommand } from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  makeReadModel,
  makeBot,
  BOSS_ID,
  SPECIALIST_ID,
  OTHER_SPECIALIST_ID,
  makeGroup,
  GROUP_ID,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * Every refusal in `group.member.assign` and `group.member.unassign` carries a
 * closed code the client picks its copy from. The prose stays on `detail` as the
 * fallback for a client that does not know the code, so each case below asserts
 * both: the code the roster switches on, and the sentence older clients still
 * read.
 */
it.layer(NodeServices.layer)("group member refusals", (it) => {
  const SOURCE_GROUP_ID = GroupId.make("group-source");
  const SOURCE_BOSS_ID = BotId.make("bot-source-boss");

  const decide = (command: OrchestrationCommand, readModel: ReturnType<typeof makeReadModel>) =>
    decideOrchestrationCommand({ command, readModel }).pipe(Effect.flip);

  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  const groupWithBots = () =>
    makeReadModel({
      bots: [
        makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
        makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
        makeBot({ id: OTHER_SPECIALIST_ID, groupId: GROUP_ID }),
      ],
      groups: [makeGroup()],
    });

  it.effect("codes an assign as boss when the space already has another boss", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.assign",
          commandId: CommandId.make("cmd-assign-second-boss"),
          groupId: GROUP_ID,
          botId: OTHER_SPECIALIST_ID,
          role: "boss",
        },
        groupWithBots(),
      );

      const { refusal, detail } = refusalOf(error);

      // The bot being assigned is not the boss here; another bot is. Telling the
      // user it leads the space would be false about the bot they picked.
      expect(refusal).toBe("group-already-has-boss");
      expect(detail).toContain("already has boss bot");
    }),
  );

  it.effect("codes an assign that demotes the current boss to specialist", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.assign",
          commandId: CommandId.make("cmd-assign-boss-as-specialist"),
          groupId: GROUP_ID,
          botId: BOSS_ID,
          role: "specialist",
        },
        groupWithBots(),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("bot-is-group-boss");
      expect(detail).toContain("cannot be assigned as a specialist");
    }),
  );

  it.effect("codes a move of a bot that is the boss of the space it is leaving", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.assign",
          commandId: CommandId.make("cmd-move-source-boss"),
          groupId: GROUP_ID,
          botId: SOURCE_BOSS_ID,
          role: "specialist",
        },
        makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
            makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
            makeBot({ id: SOURCE_BOSS_ID, groupId: SOURCE_GROUP_ID }),
            makeBot({ id: OTHER_SPECIALIST_ID, groupId: SOURCE_GROUP_ID }),
          ],
          groups: [
            makeGroup(),
            {
              ...makeGroup({
                bossBotId: SOURCE_BOSS_ID,
                members: [
                  { kind: "bot", botId: SOURCE_BOSS_ID, role: "boss" },
                  { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
                ],
              }),
              id: SOURCE_GROUP_ID,
            },
          ],
        }),
      );

      const { refusal, detail } = refusalOf(error);

      // The bot leaves one space to join another, so the space it leaves keeps
      // the same two rules as an unassign: hold its boss, keep two bots.
      expect(refusal).toBe("bot-is-group-boss");
      expect(detail).toContain("before moving it to another group");
    }),
  );

  it.effect("codes a move that would leave the space it came from with one bot", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.assign",
          commandId: CommandId.make("cmd-move-from-undersized"),
          groupId: GROUP_ID,
          botId: OTHER_SPECIALIST_ID,
          role: "specialist",
        },
        makeReadModel({
          bots: [
            makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
            makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
            makeBot({ id: SOURCE_BOSS_ID, groupId: SOURCE_GROUP_ID }),
            makeBot({ id: OTHER_SPECIALIST_ID, groupId: SOURCE_GROUP_ID }),
          ],
          groups: [
            makeGroup(),
            {
              ...makeGroup({
                bossBotId: SOURCE_BOSS_ID,
                members: [
                  { kind: "bot", botId: SOURCE_BOSS_ID, role: "boss" },
                  { kind: "bot", botId: OTHER_SPECIALIST_ID, role: "specialist" },
                ],
              }),
              id: SOURCE_GROUP_ID,
            },
          ],
        }),
      );

      const { refusal, detail } = refusalOf(error);

      // The same literal the archive and delete paths use, so a client has one
      // thing to switch on wherever a space would fall below its floor.
      expect(refusal).toBe("group-would-be-undersized");
      expect(detail).toContain("requires at least two active bots");
    }),
  );

  it.effect("codes an unassign of a bot the space no longer holds", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign-stale-member"),
          groupId: GROUP_ID,
          botId: BotId.make("bot-not-here"),
        },
        groupWithBots(),
      );

      const { refusal, detail } = refusalOf(error);

      // A stale click, not a permissions problem: the roster drew a bot the
      // server has already taken out, so the remedy is a refresh.
      expect(refusal).toBe("bot-not-a-group-member");
      expect(detail).toContain("is not a member of group");
    }),
  );

  it.effect("codes an unassign of the last boss", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign-last-boss"),
          groupId: GROUP_ID,
          botId: BOSS_ID,
        },
        groupWithBots(),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("bot-is-group-boss");
      expect(detail).toContain("is the last boss of group");
    }),
  );

  it.effect("codes an unassign that would leave the space with one bot", () =>
    Effect.gen(function* () {
      const error = yield* decide(
        {
          type: "group.member.unassign",
          commandId: CommandId.make("cmd-unassign-undersized"),
          groupId: GROUP_ID,
          botId: SPECIALIST_ID,
        },
        groupWithBots(),
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("group-would-be-undersized");
      expect(detail).toContain("requires at least two active bots");
    }),
  );
});
