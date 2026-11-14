import type { CommandRefusalCode } from "@isnadi/client-runtime/state/runtime";

type Translate = (message: string, params?: Readonly<Record<string, string | number>>) => string;

/** Why a delete failed, in the shape the settings sheet renders. */
export interface DeleteBotFailure {
  readonly refusal: CommandRefusalCode;
  /** The server's own sentence, used only when the code is one this client cannot name. */
  readonly message: string;
}

/** What a failed delete shows: a title naming the bot, and a body the app has copy for. */
export interface BotDeleteRefusalCopy {
  readonly title: string;
  readonly description: string;
}

/**
 * The sentence a refused delete shows, chosen by the refusal code the server
 * sent. A bot that leads a space is refused by the same guard the web roster
 * explains in plain words, so the two clients say the same thing; every other
 * code, including one a newer server added, keeps the server's sentence.
 */
export function botDeleteRefusalCopy(
  input: { readonly failure: DeleteBotFailure; readonly botName: string },
  t: Translate,
): BotDeleteRefusalCopy {
  const title = t("Could not delete {name}", { name: input.botName });

  if (input.failure.refusal === "bot-is-group-boss") {
    return { title, description: t("Pick a new boss, or delete the space.") };
  }

  return { title, description: input.failure.message.trim() || t("The command failed.") };
}
