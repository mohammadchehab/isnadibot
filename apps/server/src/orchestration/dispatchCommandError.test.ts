import {
  CommandRefusalCodes,
  OrchestrationDispatchCommandError,
  type CommandRefusal,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { toDispatchCommandError } from "./dispatchCommandError.ts";
import {
  internalInvariantError,
  pendingRefusalInvariantError,
  refusedInvariantError,
} from "./Errors.ts";

const encodeDispatchError = Schema.encodeEffect(OrchestrationDispatchCommandError);

const decodeDispatchError = Schema.decodeUnknownSync(OrchestrationDispatchCommandError);

const COMMAND_TYPE = "thread.update";

/**
 * The sentence a provider failure carries. Host, port and a filesystem path are
 * all in it on purpose: the ruling on TASK-389 keeps them, because they are what
 * makes the failure actionable, and requires them to cross exactly once.
 */
const RAW_SENTENCE =
  "connect ECONNREFUSED 127.0.0.1:57321 while opening /Users/someone/.isnadi/userdata/state.sqlite";

/** What the funnel prints for a throw that carries a code: the client renders the code's own sentence. */
const CODED_FALLBACK = "The command failed.";

const FALLBACK = "Failed to dispatch orchestration command";

const DETAIL = "Thread 'thread-1' is archived.";

type ThrowRow = {
  readonly name: string;
  /** The throw as a producer hands it to the funnel. */
  readonly cause: unknown;
  /** The one sentence the wire must carry, exactly once. */
  readonly sentence: string;
  readonly refusal?: CommandRefusal;
  /** Strings the throw carries that must not reach a client at all. */
  readonly mustNotCross: ReadonlyArray<string>;
};

const THROWS: ReadonlyArray<ThrowRow> = [
  {
    name: "a raw thrown Error",
    cause: new Error(RAW_SENTENCE),
    sentence: RAW_SENTENCE,
    mustNotCross: [],
  },
  {
    name: "a thrown string",
    cause: "the disk went away",
    sentence: FALLBACK,
    mustNotCross: ["the disk went away"],
  },
  {
    name: "a throw of undefined",
    cause: undefined,
    sentence: FALLBACK,
    mustNotCross: [],
  },
  {
    name: "a coded refusal",
    cause: refusedInvariantError({
      commandType: COMMAND_TYPE,
      detail: DETAIL,
      refusal: "stale-view",
    }),
    sentence: CODED_FALLBACK,
    refusal: "stale-view",
    mustNotCross: [DETAIL, COMMAND_TYPE],
  },
  {
    name: "an internal exclusion",
    cause: internalInvariantError({
      commandType: COMMAND_TYPE,
      detail: DETAIL,
      reason: "ThreadUpdateCommand rejects this at decode.",
    }),
    sentence: DETAIL,
    mustNotCross: ["rejects this at decode", COMMAND_TYPE],
  },
  {
    name: "a pending refusal",
    cause: pendingRefusalInvariantError({
      commandType: COMMAND_TYPE,
      detail: DETAIL,
      reason: "The archived flag has no code of its own yet.",
      ticket: "TASK-000",
    }),
    sentence: DETAIL,
    mustNotCross: ["has no code of its own yet", "TASK-000", COMMAND_TYPE],
  },
  {
    name: "an error the server already built for the wire",
    cause: new OrchestrationDispatchCommandError({
      message: DETAIL,
      bootstrapThreadDisposition: "deleted",
    }),
    sentence: DETAIL,
    mustNotCross: [COMMAND_TYPE],
  },
];

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/**
 * The guard for TASK-389. Every throw a client command path can hand the funnel
 * goes through the same three assertions, so a future field that carries the
 * sentence a second time fails here rather than in a user's error toast.
 */
it.effect("the wire carries one sentence and no cause, whatever the throw", () =>
  Effect.gen(function* () {
    for (const row of THROWS) {
      const wire = yield* encodeDispatchError(toDispatchCommandError(row.cause, FALLBACK));
      const json = JSON.stringify(wire);

      // The defect TASK-389 fixed: `cause` crossed beside `message`, and a
      // `Defect` re-encodes an Error as `{ name, message }`, so the sentence
      // rode the wire twice — with host, port and paths in it.
      expect(Object.keys(wire), row.name).not.toContain("cause");
      expect(occurrences(json, row.sentence), row.name).toBe(1);

      for (const secret of row.mustNotCross) {
        expect(occurrences(json, secret), `${row.name}: ${secret}`).toBe(0);
      }

      expect(wire.refusal, row.name).toBe(row.refusal);

      // A client decodes the whole exit, so the encoded form has to stay a
      // legal payload for the schema that produced it.
      expect(decodeDispatchError(wire).message, row.name).toBe(wire.message);
    }
  }),
);

it.effect("keeps host, port and paths, once, in the one sentence a person reads", () =>
  Effect.gen(function* () {
    const wire = yield* encodeDispatchError(
      toDispatchCommandError(new Error(RAW_SENTENCE), FALLBACK),
    );

    const json = JSON.stringify(wire);

    for (const fragment of ["127.0.0.1", "57321", "/Users/someone/.isnadi/userdata"]) {
      expect(occurrences(json, fragment), fragment).toBe(1);
    }
  }),
);

it.effect("every typed refusal code still crosses as itself", () =>
  Effect.gen(function* () {
    for (const refusal of CommandRefusalCodes) {
      const wire = yield* encodeDispatchError(
        toDispatchCommandError(
          refusedInvariantError({ commandType: COMMAND_TYPE, detail: DETAIL, refusal }),
          FALLBACK,
        ),
      );

      expect(wire.refusal, refusal).toBe(refusal);
      // The code's sentence is the client's to render; the server's detail, which
      // names internal ids, stays here.
      expect(JSON.stringify(wire)).not.toContain(DETAIL);
    }
  }),
);

it("declares no cause on the wire schema, so no producer can reintroduce one", () => {
  expect(Object.keys(OrchestrationDispatchCommandError.fields)).not.toContain("cause");
});
