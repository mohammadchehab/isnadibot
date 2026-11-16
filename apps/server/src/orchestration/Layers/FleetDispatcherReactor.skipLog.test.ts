import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import { describe, expect } from "vite-plus/test";

import { internalInvariantError } from "../Errors.ts";
import { GROUP_ID, SPECIALIST_ID } from "../test-support/GroupDeciderFixtures.ts";
import { harness, idleTeamModel, run, workItem } from "../test-support/FleetDispatcherFixtures.ts";

/** A log line this dispatcher wrote, as the logger received it. */
interface CapturedLine {
  readonly level: string;
  readonly message: ReadonlyArray<unknown>;
}

const SKIP_LINE = "fleet dispatcher skipped a group";

/** Every line the dispatcher wrote about a skip, whatever level it chose. */
const skipLines = (lines: ReadonlyArray<CapturedLine>) =>
  lines.filter((line) => line.message[0] === SKIP_LINE);

/** Runs a pass with a logger in place, so a test can read what the dispatcher said. */
const capturePass = <A, E, R>(
  body: (h: Effect.Success<typeof harness>) => Effect.Effect<A, E, R>,
  minimumLevel: "Info" | "Debug" = "Info",
) =>
  Effect.gen(function* () {
    const h = yield* harness;
    const lines: Array<CapturedLine> = [];

    const logger = Logger.make(({ logLevel, message }) => {
      if (!Array.isArray(message)) return;

      lines.push({ level: logLevel, message });
    });

    yield* body(h).pipe(
      Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
      Effect.provideService(References.MinimumLogLevel, minimumLevel),
    );

    return lines;
  }).pipe(Effect.scoped);

/**
 * A rejection the test injects in place of the decider's own. The reactor treats every invariant
 * rejection alike, so the arm only has to be a real one.
 */
const injectedRejection = (commandType: string, detail: string) =>
  internalInvariantError({
    commandType,
    detail,
    reason:
      "Test fixture: the test injects this rejection to exercise the dispatcher's refusal path, so no user situation produces it.",
  });

/**
 * A skip changes nothing a person can see: the item stays queued and the member stays idle. The
 * receipt that records it never leaves the process, so the log line is the only way an operator can
 * tell a group that waited from a group that never woke.
 */
describe("FleetDispatcherReactor skip log (TASK-406)", () => {
  it.effect("says why it skipped a group, naming the member and the item", () =>
    capturePass((h) =>
      Effect.gen(function* () {
        // A claim the engine refuses: the member and the item were both in hand, so the skip is all
        // that is left to say why nothing was handed out.
        yield* Ref.set(h.rejection, {
          type: "work-item.claim",
          error: injectedRejection("work-item.claim", "Work item 'item-1' is no longer queued."),
          remaining: 1,
        });
        yield* Ref.set(h.model, idleTeamModel([workItem({ id: "item-1" })]));

        yield* run(h, ({ reactor }) => reactor.drain);

        // The pass went on to hand the item out, and that decision is logged nowhere: only a skip
        // is worth a line, so a working group stays quiet.
        expect(h.dispatched.map((command) => command.type)).toEqual([
          "work-item.claim",
          "thread.turn.start",
        ]);
      }),
    ).pipe(
      Effect.map((lines) => {
        expect(skipLines(lines)).toEqual([
          {
            level: "Warn",
            message: [
              SKIP_LINE,
              expect.objectContaining({
                groupId: GROUP_ID,
                reason: "claim-lost",
                itemId: "item-1",
                botId: SPECIALIST_ID,
              }),
            ],
          },
        ]);
      }),
    ),
  );

  // A keep-busy group with nothing queued wakes on every turn end, so warning there would bury the
  // skips that mean something. This repo's reactors do not warn about finding nothing to do.
  it.effect("does not warn when the queue was simply empty", () =>
    capturePass((h) =>
      Effect.gen(function* () {
        yield* Ref.set(h.model, idleTeamModel());

        yield* run(h, ({ reactor }) => reactor.drain);

        expect(h.dispatched).toEqual([]);
      }),
    ).pipe(
      Effect.map((lines) => {
        expect(skipLines(lines)).toEqual([]);
      }),
    ),
  );

  // The other half of that quiet: the line is still there for an operator who asks for detail, so
  // an empty queue can be told apart from a group that never woke at all.
  it.effect("says an empty queue was skipped when detail is asked for", () =>
    capturePass(
      (h) =>
        Effect.gen(function* () {
          yield* Ref.set(h.model, idleTeamModel());

          yield* run(h, ({ reactor }) => reactor.drain);
        }),
      "Debug",
    ).pipe(
      Effect.map((lines) => {
        expect(skipLines(lines)).toEqual([
          {
            level: "Debug",
            message: [
              SKIP_LINE,
              expect.objectContaining({ groupId: GROUP_ID, reason: "queue-empty" }),
            ],
          },
        ]);
      }),
    ),
  );
});
