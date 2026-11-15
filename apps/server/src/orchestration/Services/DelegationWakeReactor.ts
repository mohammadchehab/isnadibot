/**
 * DelegationWakeReactor - Starts a boss turn when every delegation it is waiting on has finished,
 * so the results reach the boss without a user message.
 *
 * @module DelegationWakeReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface DelegationWakeReactorShape {
  /**
   * Start watching delegation updates and session changes. Run in a scope so the worker fiber is
   * finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for tests, in place of sleeps.
   */
  readonly drain: Effect.Effect<void>;

  /**
   * Resolves once every domain event at or before `sequence` has been observed and the wake
   * decisions they caused have been made.
   */
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

export class DelegationWakeReactor extends Context.Service<
  DelegationWakeReactor,
  DelegationWakeReactorShape
>()("isnadibot/orchestration/Services/DelegationWakeReactor") {}
