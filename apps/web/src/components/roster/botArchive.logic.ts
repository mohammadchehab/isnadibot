import { createTranslator } from "@isnadi/client-runtime/i18n";
import { commandRefusalDescription } from "@isnadi/client-runtime/state/runtime";
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
 * Two refusals reach this toast as the invariant sentence, ids included: a space
 * left too small, and a bot that leads one. The code lets the client say each in
 * words instead. Every other code the client knows takes the shared sentence, so
 * the authorization refusals that name a person id and a group id no longer
 * print them here either. A code this client does not know keeps the server's
 * own sentence, the same fallback delete and group delete use, so a newer
 * server's refusal still says something true.
 */
export function botArchiveFailureToast(
  input: {
    readonly refusal: BotArchiveRefusal;
    readonly message: string;
    readonly botName: string;
    readonly bossSpaceName: string | null;
  },
  t: Translate = englishTranslate,
): BotArchiveFailureToast {
  if (input.refusal === "bot-is-group-boss") {
    // Delete hits the same wall, so it reads the same: same title, same
    // sentence. The test holds the two equal, which is what keeps archive from
    // falling through to the invariant sentence again.
    return {
      title:
        input.bossSpaceName === null
          ? t("Could not archive {name}", { name: input.botName })
          : t("Boss of {space}", { space: input.bossSpaceName }),
      description: t("Pick a new boss, or delete the space."),
    };
  }

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
    description: commandRefusalDescription(input.refusal, input.message, { t }),
  };
}
