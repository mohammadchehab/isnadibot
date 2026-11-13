/**
 * FleetDispatcherReactor - Hands a keep-busy group's queued work to the members that are idle.
 *
 * @module FleetDispatcherReactor
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface FleetDispatcherReactorShape {
  /**
   * Start watching turn ends, work items and the keep-busy switch. Run in a scope so the worker
   * fiber is finalized on shutdown.
   */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;

  /**
   * Resolves when the internal processing queue is empty and idle.
   * Intended for tests, in place of sleeps.
   */
  readonly drain: Effect.Effect<void>;

  /**
   * Resolves once every domain event at or before `sequence` has been observed and the dispatch
   * decisions they caused have been made.
   */
  readonly drainThrough: (sequence: number) => Effect.Effect<void>;
}

export class FleetDispatcherReactor extends Context.Service<
  FleetDispatcherReactor,
  FleetDispatcherReactorShape
>()("isnadibot/orchestration/Services/FleetDispatcherReactor") {}
