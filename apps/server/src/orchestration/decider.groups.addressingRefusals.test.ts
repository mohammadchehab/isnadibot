import {
  AuthSessionId,
  BotId,
  MessageId,
  type GroupAddressing,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  BOSS_ID,
  GROUP_ID,
  PERSON_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
  startTurnCommand,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * A refused group turn start carries a code, so the client picks its own copy
 * instead of rendering the invariant sentence. The prose stays on `detail` as
 * the fallback for a client that does not know the code, so each case asserts
 * both.
 *
 * `resolveGroupAddressing`'s own arms are covered in
 * `groupResponder.refusals.test.ts`. This file covers the three places the
 * turn-start decider turns a fact into a refusal: passing the resolution's code
 * through, the send that resolves to nobody, and the sender who is not a member.
 */

const OUTSIDER_ID = AuthSessionId.make("person-outsider");

const readModel = (
  input: {
    readonly bossBotId?: BotId | null;
    readonly members?: Parameters<typeof makeGroup>[0]["members"];
  } = {},
): OrchestrationReadModel =>
  makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
    ],
    groups: [
      makeGroup({
        bossBotId: input.bossBotId === undefined ? BOSS_ID : input.bossBotId,
        ...(input.members === undefined ? {} : { members: input.members }),
      }),
    ],
    threads: [makeGroupThread()],
  });

const refusalOf = (command: OrchestrationCommand, model: OrchestrationReadModel) =>
  decideOrchestrationCommand({ command, readModel: model }).pipe(
    Effect.flip,
    Effect.map((error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
      if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected a command invariant error");
      }

      return { refusal: error.refusal, detail: error.detail };
    }),
  );

const turnStart = (addressing: GroupAddressing, model: OrchestrationReadModel) =>
  refusalOf({ ...startTurnCommand(), addressing }, model);

it.layer(NodeServices.layer)("group turn-start refusals", (it) => {
  it.effect("passes the addressing resolution's code and sentence through", () =>
    Effect.gen(function* () {
      const { refusal, detail } = yield* turnStart(
        { kind: "bots", botIds: [BotId.make("bot-departed")] },
        readModel(),
      );

      // The decider adds no code of its own here: whatever the resolution says
      // is what the client switches on, with its sentence kept for older ones.
      expect(refusal).toBe("stale-view");
      expect(detail).toBe(`Bot 'bot-departed' is not an active member of group '${GROUP_ID}'.`);
    }),
  );

  it.effect("codes a send that resolves to no bot at all", () =>
    Effect.gen(function* () {
      // No addressing and no named bot, so the send falls back to the boss — and
      // this space has none to fall back to.
      const { refusal, detail } = yield* refusalOf(
        startTurnCommand(),
        readModel({ bossBotId: null }),
      );

      expect(refusal).toBe("group-has-no-responder");
      expect(detail).toBe(`Group '${GROUP_ID}' has no boss bot that can respond.`);
    }),
  );

  it.effect("codes a sender who is not a member of the space", () =>
    Effect.gen(function* () {
      const { refusal, detail } = yield* refusalOf(
        startTurnCommand(undefined, OUTSIDER_ID),
        readModel(),
      );

      // The same code the group-management commands use: one fact, one remedy —
      // the sender needs access to this space.
      expect(refusal).toBe("actor-not-a-group-member");
      expect(detail).toBe(`Person '${OUTSIDER_ID}' is not a member of group '${GROUP_ID}'.`);
    }),
  );

  it.effect("lets an administrator send to a space it does not belong to", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: { ...startTurnCommand(undefined, OUTSIDER_ID), senderCanManageGroups: true },
        readModel: readModel(),
      });

      // The refusal above is a gate, not a wall: an administrator still gets its
      // turn, so the code must not swallow the path it guards.
      expect(Array.isArray(result) ? result : [result]).toContainEqual(
        expect.objectContaining({ type: "thread.turn-start-requested" }),
      );
    }),
  );

  it.effect("still starts a turn for a member who quotes a bot's message", () =>
    Effect.gen(function* () {
      const model = readModel();

      const withReply = {
        ...model,
        threads: model.threads.map((thread) => ({
          ...thread,
          messages: [
            {
              id: MessageId.make("message-bot"),
              role: "assistant" as const,
              text: "an answer",
              turnId: null,
              respondingBotId: SPECIALIST_ID,
              streaming: false,
              createdAt: thread.createdAt,
              updatedAt: thread.updatedAt,
            },
          ],
        })),
      };

      const result = yield* decideOrchestrationCommand({
        command: {
          ...startTurnCommand(undefined, PERSON_ID),
          addressing: { kind: "reply" as const, messageId: MessageId.make("message-bot") },
        },
        readModel: withReply,
      });

      // The codes above are refusals; this is the happy path they must not block.
      expect(Array.isArray(result) ? result : [result]).toContainEqual(
        expect.objectContaining({ type: "thread.turn-start-requested" }),
      );
    }),
  );
});
