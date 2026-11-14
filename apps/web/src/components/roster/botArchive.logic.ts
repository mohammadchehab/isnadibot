import { createTranslator } from "@isnadi/client-runtime/i18n";
import { CommandRefusal } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { Predicate, Schema } from "effect";

type Translate = (message: string, params?: Record<string, string | number>) => string;

const englishTranslate: Translate = createTranslator("en").translate;

const isCommandRefusal = Schema.is(CommandRefusal);

/** Which of `bot.archive`'s refusals came back. */
export type BotArchiveRefusal = CommandRefusal | "unknown";

/**
 * Read the refusal code the server attached to a failed archive. The wire field
 * is a permissive string, so a code this client does not know — one a newer
 * server added — is `unknown`, and the caller falls back to a sentence that
 * carries no server prose.
 */
export function classifyBotArchiveFailure(failure: {
  readonly cause: Cause.Cause<unknown>;
}): BotArchiveRefusal {
  const error = Cause.squash(failure.cause);

  const refusal =
    Predicate.isObjectOrArray(error) && error !== null && "refusal" in error
      ? error.refusal
      : undefined;

  return isCommandRefusal(refusal) ? refusal : "unknown";
}

/** The copy a failed archive shows, chosen by the refusal the server sent. */
export interface BotArchiveFailureToast {
  readonly title: string;
  readonly description: string;
}

/**
 * The copy a refused archive shows, chosen by the refusal the server sent.
 *
 * Archiving one of two bots in a space is refused by the decider. That refusal
 * used to reach the toast as the invariant sentence, group id included; the code
 * lets the client say the floor in words instead. A code this client does not
 * know keeps the server's own sentence, the same fallback delete and group
 * delete use, so a newer server's refusal still says something true.
 */
export function botArchiveFailureToast(
  input: {
    readonly refusal: BotArchiveRefusal;
    readonly message: string;
    readonly botName: string;
  },
  t: Translate = englishTranslate,
): BotArchiveFailureToast {
  if (input.refusal === "group-would-be-undersized") {
    return {
      // The space is the subject, not the bot: nothing about this one bot
      // explains the floor, so the title drops the name and matches the
      // delete toast's wording for the same rule.
      title: t("This group needs at least two bots"),
      description: t(
        "Archiving this bot would leave this space with fewer than two. Add another bot first.",
      ),
    };
  }

  return {
    title: t("Could not archive {name}", { name: input.botName }),
    description: input.message.trim() || t("The command failed."),
  };
}
