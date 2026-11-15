import { SubscriptionAuthError } from "@isnadi/contracts";
import * as Effect from "effect/Effect";

/**
 * Replace any failure with the written copy a surface shows, logging the cause
 * on the way. The cause carries filesystem paths and internal wording, so it
 * goes to the log and never to `reason` — the sentence the user reads.
 */
export const subscriptionAuthFailure =
  (reason: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, SubscriptionAuthError, R> =>
    effect.pipe(
      Effect.tapError((cause) => Effect.logWarning(reason, { cause })),
      Effect.mapError(() => new SubscriptionAuthError({ reason })),
    );
