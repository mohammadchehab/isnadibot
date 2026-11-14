import { CommandRefusal } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { Predicate, Schema } from "effect";

import { createTranslator } from "../i18n/translator.ts";
import type { MessageKey, TranslationParams } from "../i18n/types.ts";

/** The translator shape every client passes in; the web and mobile `t` both fit it. */
type Translate = (message: string, params?: TranslationParams) => string;

const englishTranslate: Translate = createTranslator("en").translate;

const isCommandRefusal = Schema.is(CommandRefusal);

/**
 * A server failure may squash to a plain `Error` or to one of the tagged error
 * objects the contracts define; both carry the sentence the user would read.
 */
const isMessageCarrier = Schema.is(Schema.Struct({ message: Schema.String }));

/** The refusal code a failed command carried, or `unknown` for one this client does not know. */
export type CommandFailureRefusal = CommandRefusal | "unknown";

/**
 * The sentence one refusal code shows when the surface has no more specific
 * copy for it. Deliberately generic: the same code reaches settings, roster and
 * chat surfaces, so the wording cannot name a group, a bot, or a person.
 */
const refusalMessages: Record<CommandRefusal, MessageKey> = {
  "environment-rights": "Changing this environment needs permission. Ask the person who runs it.",
  "open-work-items":
    "This group still holds open work. Delete again to see how many items would be discarded.",
  "bot-is-group-boss": "This bot leads a space. Pick a new boss, or delete the space.",
  "group-would-be-undersized":
    "This space needs at least two bots. Add another bot before you remove one.",
};

/**
 * Which refusal code a failed command carried. The wire field is a permissive
 * string, so a code a newer server added is `unknown` and the caller keeps the
 * server's own sentence instead of guessing at its meaning.
 */
export function classifyCommandFailure(failure: {
  readonly cause: Cause.Cause<unknown>;
}): CommandFailureRefusal {
  const error = Cause.squash(failure.cause);

  const refusal =
    Predicate.isObjectOrArray(error) && "refusal" in error ? error.refusal : undefined;

  return isCommandRefusal(refusal) ? refusal : "unknown";
}

/** The server's own sentence for a failure, trimmed, or null when it sent none. */
function serverMessage(failure: { readonly cause: Cause.Cause<unknown> }): string | null {
  const error = Cause.squash(failure.cause);

  const message =
    error instanceof Error ? error.message : isMessageCarrier(error) ? error.message : "";

  const trimmed = message.trim();

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The sentence a failed command shows. A refusal code the client knows gets
 * localized copy, because the server's own sentence for it carries internal
 * ids and invariant prose — an `environment-rights` refusal names the person's
 * id and the scope, which is why every surface used to leak it. A code this
 * client does not know keeps the server's sentence, so a newer server's refusal
 * still says something true.
 *
 * `fallback` is the surface's own wording for a failure with neither a known
 * code nor a server sentence. Without a `t` the sentence stays English, which
 * is what an untranslated surface already showed.
 */
export function commandFailureMessage(
  failure: { readonly cause: Cause.Cause<unknown> },
  options: {
    readonly t?: Translate;
    readonly fallback?: string;
  } = {},
): string {
  const { t = englishTranslate, fallback = "The command failed." } = options;
  const refusal = classifyCommandFailure(failure);

  if (refusal !== "unknown") return t(refusalMessages[refusal]);

  return serverMessage(failure) ?? t(fallback);
}
