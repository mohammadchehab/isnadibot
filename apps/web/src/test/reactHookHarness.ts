import * as Predicate from "effect/Predicate";
import type { Dispatch, SetStateAction } from "react";

/**
 * Minimal React hook shim for tests that call components as plain functions
 * instead of mounting a renderer. Slots are keyed by call order, mirroring
 * React's own rules-of-hooks contract, and `useMemoCache` emulates the React
 * Compiler runtime so compiled components can execute unmodified.
 *
 * This module must stay free of runtime `react` imports: it is loaded from
 * inside `vi.mock("react", ...)` factories, and a value import would recurse
 * into the in-progress mock. Wire it up in each test file (mock calls cannot
 * live here because vitest hoists them per test module):
 *
 * ```ts
 * import { reactHookHarness } from "~/test/reactHookHarness";
 *
 * vi.mock("react", async (importOriginal) => {
 *   const actual = await importOriginal<typeof import("react")>();
 *   const { reactHookHarness } = await import("~/test/reactHookHarness");
 *   return {
 *     ...actual,
 *     useCallback: reactHookHarness.useCallback,
 *     useEffect: reactHookHarness.useEffect,
 *     useMemo: reactHookHarness.useMemo,
 *     useRef: reactHookHarness.useRef,
 *     useState: reactHookHarness.useState,
 *   };
 * });
 * vi.mock("react/compiler-runtime", async () => {
 *   const { reactHookHarness } = await import("~/test/reactHookHarness");
 *   return { c: reactHookHarness.useMemoCache };
 * });
 * ```
 *
 * Call `beginRender()` before each component invocation, `flushEffects()` after the render whose
 * effects a test needs, and `reset()` in `beforeEach` to drop persisted state between tests.
 */
interface EffectSlot {
  readonly deps: readonly unknown[] | undefined;
  cleanup: (() => void) | undefined;
}

function sameDeps(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (previous === undefined || next === undefined) return false;

  if (previous.length !== next.length) return false;

  return previous.every((value, index) => Object.is(value, next[index]));
}

export function createReactHookHarness() {
  let cursor = 0;
  let slots: unknown[] = [];
  let pendingEffects: Array<{ index: number; effect: () => void | (() => void) }> = [];
  const nextIndex = () => cursor++;

  return {
    beginRender() {
      cursor = 0;
    },
    reset() {
      for (const { index } of pendingEffects) {
        (slots[index] as EffectSlot | undefined)?.cleanup?.();
      }

      pendingEffects = [];
      cursor = 0;
      slots = [];
    },
    /**
     * Queues an effect whose dependencies changed during this render, the way React does, and
     * leaves running it to `flushEffects`. A test that needs the effect's `setState` result calls
     * the component again, which is the re-render React would schedule.
     */
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void {
      const index = nextIndex();
      const slot = slots[index] as EffectSlot | undefined;

      if (slot !== undefined && deps !== undefined && sameDeps(slot.deps, deps)) return;

      slots[index] = { deps, cleanup: slot?.cleanup };
      pendingEffects.push({ index, effect });
    },
    /** Runs every queued effect once, in render order, after each cleanup the previous run left. */
    flushEffects() {
      const queue = pendingEffects;

      pendingEffects = [];

      for (const { index, effect } of queue) {
        const slot = slots[index] as EffectSlot;

        slot.cleanup?.();
        const cleanup = effect();

        slot.cleanup = Predicate.isFunction(cleanup) ? cleanup : undefined;
      }
    },
    useCallback<T>(callback: T): T {
      nextIndex();

      return callback;
    },
    useMemo<T>(factory: () => T): T {
      nextIndex();

      return factory();
    },
    useMemoCache(size: number): unknown[] {
      const index = nextIndex();

      if (!slots[index]) {
        slots[index] = Array.from({ length: size }, () => Symbol.for("react.memo_cache_sentinel"));
      }

      return slots[index] as unknown[];
    },
    useRef<T>(initialValue: T): { current: T } {
      const index = nextIndex();

      if (!slots[index]) {
        slots[index] = { current: initialValue };
      }

      return slots[index] as { current: T };
    },
    /**
     * Reads the store once per render and does not subscribe: a component
     * invoked as a plain function is never re-rendered by a store change, and
     * subscribing would only leak listeners across tests. The slot is still
     * consumed so later hooks keep the positions a real render would give them.
     */
    useSyncExternalStore<Snapshot>(
      _subscribe: (listener: () => void) => () => void,
      getSnapshot: () => Snapshot,
    ): Snapshot {
      nextIndex();

      return getSnapshot();
    },
    useState<T>(initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
      const index = nextIndex();

      if (index >= slots.length) {
        slots[index] = Predicate.isFunction(initialValue)
          ? (initialValue as () => T)()
          : initialValue;
      }

      const setValue: Dispatch<SetStateAction<T>> = (nextValue) => {
        const previous = slots[index] as T;
        slots[index] = Predicate.isFunction(nextValue)
          ? (nextValue as (value: T) => T)(previous)
          : nextValue;
      };

      return [slots[index] as T, setValue];
    },
  };
}

/** Shared instance so `vi.mock` factories and test bodies see the same slots. */
export const reactHookHarness = createReactHookHarness();
