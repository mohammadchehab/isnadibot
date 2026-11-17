import {
  HANDOFF_REQUEST_MESSAGE_PREFIX,
  MessageId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError, refusedInvariantError } from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import { requireThread } from "../commandInvariants.ts";
import { requireActiveResponder, type DecideOrchestrationCommandResult } from "./eventBase.ts";
import { decideThreadTurns } from "./threadTurns.ts";

/**
 * What a bot reads when the user hands its context over. The server writes it so
 * no client composes the instruction a bot acts on, and the chat hides it: the
 * message id carries `HANDOFF_REQUEST_MESSAGE_PREFIX`, which the transcript
 * filters on.
 */
const HANDOFF_REQUEST_BRIEF = [
  "Hand off this chat now, before you answer me: call the handoff tool once with the six rows —",
  "item, branch, what is done, the next step, what you are waiting on, and what not to do.",
  "Your context is cut after the note when this turn ends, so anything the next session needs has to be in it.",
  "Then reply to me in one short line.",
].join(" ");

/**
 * Asks one bot of a chat to hand its context over. The turn it starts is an
 * ordinary turn — the queue, the checkpoint and the session see a user message —
 * with two differences the rest of the server reads: the message id is prefixed
 * so clients keep the brief out of the transcript, and the trigger names the bot
 * and the request so the reactor knows a note is owed.
 */
export const decideThreadHandoff = Effect.fn("decideThreadHandoff")(function* ({
  command,
  readModel,
  actor,
}: {
  readonly command: Extract<OrchestrationCommand, { type: "thread.handoff.request" }>;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  const thread = yield* requireThread({
    readModel,
    command,
    threadId: command.threadId,
  });

  yield* requireActiveResponder({
    readModel,
    command,
    groupId: thread.groupId,
    botId: command.botId,
  });

  // A direct chat has exactly one bot, so a request for any other bot would run
  // a turn that bot never sees. A client naming another bot is looking at a chat
  // it no longer sees.
  if (thread.groupId === null && thread.botId !== command.botId) {
    return yield* refusedInvariantError({
      commandType: command.type,
      detail: `Bot '${command.botId}' is not the bot of direct chat '${command.threadId}'.`,
      refusal: "stale-view",
    });
  }

  return yield* decideThreadTurns({
    command: {
      type: "thread.turn.start",
      commandId: command.commandId,
      threadId: command.threadId,
      message: {
        messageId: MessageId.make(`${HANDOFF_REQUEST_MESSAGE_PREFIX}${command.commandId}`),
        role: "user",
        text: HANDOFF_REQUEST_BRIEF,
        attachments: [],
      },
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      // A direct chat answers with its own bot and refuses a named one, so the
      // responder is named only where the chat has more than one bot to pick.
      ...(thread.groupId === null ? {} : { respondingBotId: command.botId }),
      trigger: { kind: "handoff", botId: command.botId },
      // The requester speaks for the turn: a group chat checks that this person
      // may address it, and the message is theirs as far as the chat is concerned.
      ...(actor === undefined
        ? {}
        : { senderPersonId: actor.personId, senderCanManageGroups: actor.canManageGroups }),
      createdAt: command.createdAt,
    },
    readModel,
  });
});
