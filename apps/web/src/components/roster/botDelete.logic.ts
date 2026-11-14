import { createTranslator } from "@isnadi/client-runtime/i18n";
import { CommandRefusal, type OrchestrationGroup } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { Predicate, Schema } from "effect";

type Translate = (message: string, params?: Record<string, string | number>) => string;

const englishTranslate: Translate = createTranslator("en").translate;

const isCommandRefusal = Schema.is(CommandRefusal);

/**
 * The group this bot leads, or null when it leads none. The decider refuses a
 * boss delete by the same test, so the space named before the delete and the
 * space its refusal would name are the same one.
 */
export function bossGroupOf(
  groups: readonly OrchestrationGroup[],
  botId: string,
): OrchestrationGroup | null {
  return groups.find((group) => group.bossBotId === botId) ?? null;
}

/** Which of `bot.delete`'s refusals came back. */
export type BotDeleteRefusal = CommandRefusal | "unknown";

/**
 * Read the refusal code the server attached to a failed delete. The wire field
 * is a permissive string, so a code this client does not know — one a newer
 * server added — is `unknown`, and the caller falls back to a sentence that
 * carries no server prose.
 */
export function classifyBotDeleteFailure(failure: {
  readonly cause: Cause.Cause<unknown>;
}): BotDeleteRefusal {
  const error = Cause.squash(failure.cause);

  const refusal =
    Predicate.isObjectOrArray(error) && error !== null && "refusal" in error
      ? error.refusal
      : undefined;

  return isCommandRefusal(refusal) ? refusal : "unknown";
}

/**
 * What the delete confirmation asks. A boss delete names the space in the way
 * and how to get past it, so the reason is visible before anything is
 * dispatched. The shipped renderer splits this on the question mark into the
 * dialog's title and description.
 */
export function botDeleteConfirmMessage(
  input: { readonly botName: string; readonly bossSpaceName: string | null },
  t: Translate = englishTranslate,
): string {
  if (input.bossSpaceName === null) {
    return t("Delete {name}? Its chats stay in your history. This cannot be undone.", {
      name: input.botName,
    });
  }

  return t(
    "Delete {name}? {name} is the boss of {space}. Pick a new boss in the space first, or delete the space.",
    { name: input.botName, space: input.bossSpaceName },
  );
}

/** The copy a failed delete shows, chosen by the refusal the server sent. */
export interface BotDeleteFailureToast {
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string | null;
}

/**
 * The copy a refused delete shows, chosen by the refusal the server sent.
 *
 * A boss refusal offers the way out as a toast action. A code this client does
 * not know keeps the server's own sentence, the same fallback group delete
 * uses, so a newer server's refusal still says something true. The boss and
 * undersized-group refusals are rewritten, because both used to leak ids and
 * invariant prose on paths the app has copy for.
 */
export function botDeleteFailureToast(
  input: {
    readonly refusal: BotDeleteRefusal;
    readonly message: string;
    readonly botName: string;
    readonly bossSpaceName: string | null;
  },
  t: Translate = englishTranslate,
): BotDeleteFailureToast {
  if (input.refusal === "bot-is-group-boss") {
    return {
      // The bot became a boss after the pre-dispatch check, so the roster may
      // not name the space yet. The way out still reads, without an action
      // that would navigate nowhere.
      title:
        input.bossSpaceName === null
          ? t("Could not delete {name}", { name: input.botName })
          : t("Boss of {space}", { space: input.bossSpaceName }),
      description: t("Pick a new boss, or delete the space."),
      actionLabel: input.bossSpaceName === null ? null : t("Pick a new boss"),
    };
  }

  if (input.refusal === "group-would-be-undersized") {
    return {
      title: t("This group needs at least two bots"),
      description: t(
        "Deleting this bot would leave this space with fewer than two. Add another bot first.",
      ),
      actionLabel: null,
    };
  }

  return {
    title: t("Could not delete {name}", { name: input.botName }),
    description: input.message.trim() || t("The command failed."),
    actionLabel: null,
  };
}
