import type { OrchestrationCommand, OrchestrationReadModel } from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError, refusedInvariantError } from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import { requireThread } from "../commandInvariants.ts";
import {
  requireActiveResponder,
  withEventBase,
  type DecideOrchestrationCommandResult,
} from "./eventBase.ts";

/**
 * The per-bot context epoch. A reset cuts one bot's model context at a message
 * without touching the chat the user reads, and an undo puts that bot back on
 * the cut it had before. In a group chat every other bot is untouched: the cut
 * is keyed by (chat, bot), not by chat.
 */
export const decideThreadContext = Effect.fn("decideThreadContext")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    { type: "thread.context.reset" | "thread.context.reset.undo" }
  >;
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

  // A direct chat has exactly one bot, so a cut for any other bot would write a
  // row nothing reads while the client reports a reset that never happens. A
  // client naming another bot is looking at a chat it no longer sees.
  if (thread.groupId === null && thread.botId !== command.botId) {
    return yield* refusedInvariantError({
      commandType: command.type,
      detail: `Bot '${command.botId}' is not the bot of direct chat '${command.threadId}'.`,
      refusal: "stale-view",
    });
  }

  switch (command.type) {
    case "thread.context.reset": {
      // The cut is a message the bot's next context starts after, so it has to
      // be a message this chat actually holds. A client that offers one the
      // chat has dropped (a revert raced the click) is told to reload instead
      // of being cut at a position the server cannot name.
      const cutIndex = thread.messages.findIndex(
        (message) => message.id === command.sinceMessageId,
      );

      if (cutIndex < 0) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Message '${command.sinceMessageId}' is not in chat '${command.threadId}'.`,
          refusal: "stale-view",
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.context-reset",
        payload: {
          threadId: command.threadId,
          botId: command.botId,
          sinceMessageId: command.sinceMessageId,
          sinceSequence: cutIndex + 1,
          handoffActivityId: command.handoffActivityId ?? null,
          resetAt: command.createdAt,
        },
      };
    }

    case "thread.context.reset.undo": {
      return {
        ...(yield* withEventBase({
          aggregateKind: "thread",
          aggregateId: command.threadId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "thread.context-reset-undone",
        payload: {
          threadId: command.threadId,
          botId: command.botId,
          undoneAt: command.createdAt,
        },
      };
    }
  }
});
