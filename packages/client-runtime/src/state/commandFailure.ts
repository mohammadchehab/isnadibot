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
  "group-requires-boss": "This space needs a boss. Choose which bot leads it.",
  "boss-cannot-be-replaced-and-removed":
    "This bot already leads the space. Pick a different boss, or keep this one.",
  "delegation-limit-reached":
    "This bot already has as many delegations open as it can take. Wait for one to finish.",
  "delegation-would-cycle": "This delegation would loop back on itself. Choose a different bot.",
  "actor-not-a-group-member":
    "You are not a member of this space. Ask the person who runs it for access.",
  "leave-only-as-yourself":
    "You can only leave a space as yourself. To remove someone else, you need to manage the space.",
  "bot-not-a-group-member": "That bot is no longer in this space. Refresh to see the current team.",
  "bot-in-another-group":
    "This bot belongs to another space. Create this space without it, then add the bot.",
  "group-already-has-boss":
    "This space already has a boss. Replace the boss before making this bot the boss.",
  "thread-is-busy": "This chat has work in flight. Wait for it to finish, or respond to it.",
  "thread-state-invalid":
    "That action does not fit this chat's current state. Refresh and try again.",
  "channel-delivery-unavailable": "Channel delivery is not available for this chat or message.",
  "stale-view": "Something here has changed. Refresh to see the latest.",
  "already-exists": "It already exists. Refresh to see it.",
  "entity-archived": "It is archived. Restore it first, then try again.",
  "workspace-root-in-use": "Another project already uses that folder. Choose a different one.",
  "unknown-fleet-template":
    "This template is not available in this version. Update the app, then try again.",
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
 * The shared sentence for a refusal code, or null for a code this client does
 * not know. A surface that has more specific copy for one code — a delete that
 * can name the space a bot leads — branches before calling this. Every other
 * code comes from the one table above, so a code no surface was written for
 * still says something true instead of echoing the server's sentence and the
 * internal ids inside it.
 */
export function commandRefusalMessage(
  refusal: CommandFailureRefusal,
  t: Translate = englishTranslate,
): string | null {
  return refusal === "unknown" ? null : t(refusalMessages[refusal]);
}

/**
 * The body a surface shows for a refused command, for a caller that has already
 * classified the refusal: the shared copy when the client knows the code, else
 * the server's own sentence, else `fallback`. Surfaces with more specific copy
 * for one code branch first and call this for everything else, so no surface
 * has to decide on its own which codes fall through to the server's sentence.
 */
export function commandRefusalDescription(
  refusal: CommandFailureRefusal,
  message: string,
  options: {
    readonly t?: Translate;
    readonly fallback?: string;
  } = {},
): string {
  const { t = englishTranslate, fallback = "The command failed." } = options;

  const shared = commandRefusalMessage(refusal, t);

  if (shared !== null) return shared;

  return message.trim() || t(fallback);
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

  const shared = commandRefusalMessage(classifyCommandFailure(failure), t);

  if (shared !== null) return shared;

  return serverMessage(failure) ?? t(fallback);
}
