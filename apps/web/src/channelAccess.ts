import * as Predicate from "effect/Predicate";
import * as Cause from "effect/Cause";
import * as Schema from "effect/Schema";

import {
  AuthAccessWriteScope,
  type AuthSessionState,
  type ChannelBinding,
  type ChannelProvider,
  OrchestrationDispatchCommandError,
} from "@isnadi/contracts";

export function canManageChannels(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null,
): boolean {
  return session?.authenticated === true && session.scopes?.includes(AuthAccessWriteScope) === true;
}

export function resolveChannelSettingsAccess(input: {
  readonly isPending: boolean;
  readonly session: Pick<AuthSessionState, "authenticated" | "scopes"> | null;
}): "pending" | "allowed" | "denied" {
  if (input.session === null && input.isPending) return "pending";

  return canManageChannels(input.session) ? "allowed" : "denied";
}

export function connectedChannelBinding(
  bindings: ReadonlyArray<ChannelBinding> | undefined,
  provider: ChannelProvider,
): ChannelBinding | undefined {
  return bindings?.find(
    (binding) => binding.provider === provider && binding.status === "connected",
  );
}

const CHANNEL_IDENTITY_CONFLICT =
  /^This channel connection is (?:already connected|attached) to another bot\.$/u;

/**
 * Whether a failed channel command was rejected because another bot already owns the provider
 * account. The server sends one of two fixed messages for this case, and only an exact match counts.
 */
export function isChannelIdentityConflict(result: {
  readonly cause?: Cause.Cause<unknown>;
}): boolean {
  if (!result.cause) return false;
  const error = Cause.squash(result.cause);

  const message =
    (error === null || Predicate.isObjectOrArray(error)) && error !== null && "message" in error
      ? error.message
      : error;

  return Predicate.isString(message) && CHANNEL_IDENTITY_CONFLICT.test(message);
}

const isDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

/**
 * The server's failure for a channel command, when that is what the command returned. Only a
 * dispatch error carries fixed, client-safe text; the category on it is a plain string that this
 * build may not know yet, and the presentation layer narrows it.
 */
export function channelCommandFailureOf(result: {
  readonly cause?: Cause.Cause<unknown>;
}): { readonly category?: string; readonly message: string } | undefined {
  if (!result.cause) return undefined;
  const error = Cause.squash(result.cause);

  if (!isDispatchCommandError(error)) return undefined;

  return {
    message: error.message,
    ...(error.channelFailureCategory ? { category: error.channelFailureCategory } : {}),
  };
}
