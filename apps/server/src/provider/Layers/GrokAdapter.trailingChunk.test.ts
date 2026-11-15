import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@isnadi/contracts";

import {
  awaitReceipt,
  grokAdapterTestLayer,
  makeMockGrokWrapper,
  makeTestAdapter,
} from "./test-support/grokAdapterHarness.ts";

it.layer(grokAdapterTestLayer)("GrokAdapterTrailingChunk", (it) => {
  /**
   * A provider finishes generating before every token has crossed the pipe, so `prompt_complete`
   * can arrive while a chunk is still in flight. The turn must not settle out from under that
   * chunk: if it does, `activeTurnId` is cleared, the notification resolves to no turn, and
   * `GrokSessionLifecycle` drops it — the tail of the reply is lost for good.
   */
  it.effect("keeps a trailing chunk that arrives after the prompt settled", () =>
    Effect.gen(function* () {
      const threadId = ThreadId.make("grok-trailing-chunk");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockGrokWrapper({
          T3_ACP_EMIT_XAI_PROMPT_COMPLETE_THEN_HANG: "1",
          // The chunk trails the completion by enough that the settle cannot win the race by
          // accident; at 0ms the ordering is a race that happens to land the right way on an idle
          // box, which is exactly why the loaded CI runner saw the tail disappear.
          T3_ACP_TRAILING_CHUNK_DELAY_MS: "150",
        }),
      );

      const adapter = yield* makeTestAdapter(wrapperPath);

      const runtimeEvents: ProviderRuntimeEvent[] = [];
      const sawTurnCompleted = yield* Deferred.make<void>();
      const sawTrailingChunk = yield* Deferred.make<void>();

      const runtimeEventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
        Effect.sync(() => {
          runtimeEvents.push(event);
        }).pipe(
          Effect.andThen(
            event.type === "turn.completed"
              ? Deferred.succeed(sawTurnCompleted, undefined)
              : event.type === "content.delta" && event.payload.delta === "mock"
                ? Deferred.succeed(sawTrailingChunk, undefined)
                : Effect.void,
          ),
        ),
      ).pipe(Effect.forkChild);

      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("grok"),
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-build" },
      });

      yield* adapter.sendTurn({ threadId, input: "exercise trailing chunk", attachments: [] });

      // Teardown has to survive a failing assertion: the event-stream fiber never ends on its own,
      // so a bare sequence would leave the scope open and the failure would surface as vitest's
      // 120s timeout instead of the deadline that names what went missing.
      yield* Effect.gen(function* () {
        assert.isTrue(yield* awaitReceipt(sawTurnCompleted), "turn.completed never arrived");
        assert.isTrue(
          yield* awaitReceipt(sawTrailingChunk),
          "the trailing 'mock' content delta never arrived after turn.completed: the turn settled while the chunk was still in flight and the notification was dropped",
        );

        const content = runtimeEvents
          .flatMap((event) =>
            event.type === "content.delta" && String(event.threadId) === String(threadId)
              ? [event.payload.delta]
              : [],
          )
          .join("");

        const terminalIndex = runtimeEvents.findIndex(
          (event) => event.type === "turn.completed" && String(event.threadId) === String(threadId),
        );

        const outputAfterTerminal = runtimeEvents
          .slice(terminalIndex + 1)
          .filter(
            (event) =>
              String(event.threadId) === String(threadId) && event.type === "content.delta",
          );

        // The reply must arrive whole. Its POSITION relative to the terminal is the provider's to
        // decide: once `prompt_complete` has arrived, a chunk the provider has not written yet
        // cannot be waited for without inventing a quiescence timeout. So the adapter guarantees
        // delivery, not order — and this asserts the part that was actually broken, the loss.
        assert.equal(content, "hello from mock");

        const trailingAfterTerminal = outputAfterTerminal.every(
          (event) => event.type === "content.delta" && event.payload.delta === "mock",
        );

        assert.isTrue(
          trailingAfterTerminal,
          "a turn output event other than the trailing chunk arrived after turn.completed",
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Fiber.interrupt(runtimeEventsFiber);
            yield* adapter.stopSession(threadId).pipe(Effect.orDie);
          }),
        ),
      );
    }),
  );
});
