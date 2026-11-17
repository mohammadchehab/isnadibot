/**
 * HandoffReactor - Advances a bot's context cut when the turn that wrote its
 * handoff note ends, so the cut lands after the turn rather than mid-turn.
 *
 * @module HandoffReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface HandoffReactorShape {
  /**
   * Start watching turn ends. Run in a scope so the worker fiber is finalized on
   * shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for tests, in place of sleeps.
   */
  readonly drain: Effect.Effect<void>;

  /**
   * Resolves once every domain event at or before `sequence` has been observed
   * and the cuts they owed have been decided.
   */
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

export class HandoffReactor extends Context.Service<HandoffReactor, HandoffReactorShape>()(
  "isnadibot/orchestration/Services/HandoffReactor",
) {}
