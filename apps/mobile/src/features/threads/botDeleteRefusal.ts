import {
  type CommandRefusalCode,
  commandRefusalDescription,
} from "@isnadi/client-runtime/state/runtime";

type Translate = (message: string, params?: Readonly<Record<string, string | number>>) => string;

/** Why a delete failed, in the shape the settings sheet renders. */
export interface DeleteBotFailure {
  readonly refusal: CommandRefusalCode;
}

/** What a failed delete shows: a title naming the bot, and a body the app has copy for. */
export interface BotDeleteRefusalCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The sentence a refused delete shows, chosen by the refusal code the server
 * sent. The two guards a user meets most often — a bot that leads a space, and
 * the last two bots in one — are refused by the same codes the web roster
 * explains in plain words, so the two clients say the same thing. Every other
 * code the client knows takes the shared sentence, so the authorization
 * refusals that name a person id and a group id no longer print them here. A
 * code a newer server added takes the shared fallback: the refusal vocabulary is
 * the server's, so a code this build cannot name is not news it can word.
 *
 * The failure carries no `message` on purpose. Once a refusal carries a code the
 * wire `message` is a fixed placeholder, so accepting it would let a caller pass
 * server text that is then ignored.
 */
export function botDeleteRefusalCopy(
  input: { readonly failure: DeleteBotFailure; readonly botName: string },
  t: Translate,
): BotDeleteRefusalCopy {
  if (input.failure.refusal === "group-would-be-undersized") {
    return {
      title: t("This group needs at least two bots"),
      description: t(
        "Deleting this bot would leave this space with fewer than two. Add another bot first.",
      ),
    };
  }

  const title = t("Could not delete {name}", { name: input.botName });

  if (input.failure.refusal === "bot-is-group-boss") {
    return { title, description: t("Pick a new boss, or delete the space.") };
  }

  return {
    title,
    description: commandRefusalDescription(input.failure.refusal, { t }),
  };
}
