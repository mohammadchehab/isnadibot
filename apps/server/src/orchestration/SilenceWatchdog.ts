import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";

/** How long a running turn may stay quiet before the chat reports it as silent. */
export const SILENCE_WATCHDOG_SILENT_MS = 90_000;

/**
 * How long a silent turn may stand before the watchdog gives up on it.
 *
 * Silence is a provisional observation, not a fact: the provider has said nothing yet, so the mark
 * never ends the turn by itself and output may still arrive. A mark that nothing withdraws would
 * keep its turn open forever, though, so it expires once it has outlived the same inactivity window
 * the provider session reaper trusts for a session with no sign of life (30 minutes). The window is
 * deliberately far longer than the silent one: a single long tool call emits no provider events, and
 * ending a turn that is merely quiet would be a lie about work that is still happening.
 */
export const SILENT_TURN_LIVENESS_MS = 30 * 60 * 1_000;

export interface SilenceWatchdogCallbacks {
  /** Runs once per silent window, with the time of the last provider activity. */
  readonly onSilent: (lastActivityAtMs: number) => Effect.Effect<void>;
  /** Runs when activity arrives after `onSilent`, closing the window. */
  readonly onResumed: Effect.Effect<void>;
  /** Runs when a silent window outlives `SILENT_TURN_LIVENESS_MS`; the turn must be settled. */
  readonly onExpired: Effect.Effect<void>;
}

export interface SilenceWatchdogHandle {
  readonly touch: Effect.Effect<void>;
  readonly suspend: Effect.Effect<void>;
  readonly resume: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
}

type WatchdogSignal = "activity" | "pause" | "resume" | "stop";

/**
 * A per-turn watchdog. Its fiber is owned by the caller's Scope. `touch` records
 * provider activity, `suspend`/`resume` bracket waits on the user (approvals,
 * questions), and `stop` disposes it when the turn ends. Stopping never runs
 * `onResumed`; the turn ending is its own reverse state.
 */
export const startSilenceWatchdog = (input: {
  readonly callbacks: SilenceWatchdogCallbacks;
}): Effect.Effect<SilenceWatchdogHandle, never, Scope.Scope> =>
  Effect.gen(function* () {
    const wake = yield* Queue.unbounded<WatchdogSignal>();
    const stopped = yield* Deferred.make<void>();
    let stopRequested = false;

    const fiber = yield* Effect.gen(function* () {
      let lastActivity = yield* Clock.currentTimeMillis;
      let silent = false;
      let paused = 0;

      while (true) {
        const elapsed = (yield* Clock.currentTimeMillis) - lastActivity;

        if (!silent && paused === 0 && elapsed >= SILENCE_WATCHDOG_SILENT_MS) {
          yield* input.callbacks.onSilent(lastActivity);
          silent = true;
        }

        // A silent turn waits one liveness window for the provider to speak again; if it never
        // does, the mark has outlived the window and the turn is settled. A turn waiting on the
        // user has no timer at all: the user is the reason it is quiet, so there is nothing to time.
        const waited = yield* Queue.take(wake).pipe(
          paused > 0
            ? Effect.map(Option.some)
            : silent
              ? Effect.timeoutOption(
                  Duration.millis(
                    Math.max(0, SILENCE_WATCHDOG_SILENT_MS + SILENT_TURN_LIVENESS_MS - elapsed),
                  ),
                )
              : Effect.timeoutOption(Duration.millis(SILENCE_WATCHDOG_SILENT_MS - elapsed)),
        );

        if (Option.isNone(waited)) {
          if (silent) {
            yield* input.callbacks.onExpired;

            return;
          }

          // The silence timer fired; the next pass reports it.
          continue;
        }

        const signal = waited.value;

        if (signal === "stop") return;

        if (signal === "activity") {
          lastActivity = yield* Clock.currentTimeMillis;

          if (silent) {
            silent = false;
            yield* input.callbacks.onResumed;
          }
        }

        if (signal === "pause") paused += 1;

        if (signal === "resume") {
          // Time spent waiting on the user never counts toward silence.
          paused = Math.max(0, paused - 1);
          lastActivity = yield* Clock.currentTimeMillis;
        }
      }
    }).pipe(Effect.ensuring(Deferred.succeed(stopped, void 0)), Effect.forkScoped);

    const offer = (signal: WatchdogSignal) => Queue.offer(wake, signal).pipe(Effect.asVoid);

    const stop = Effect.gen(function* () {
      if (!stopRequested) {
        stopRequested = true;
        yield* offer("stop");
      }

      yield* Deferred.await(stopped);
      yield* Fiber.interrupt(fiber);
    });

    return {
      touch: offer("activity"),
      suspend: offer("pause"),
      resume: offer("resume"),
      stop,
    } satisfies SilenceWatchdogHandle;
  });
