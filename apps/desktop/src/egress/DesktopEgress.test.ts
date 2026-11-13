import * as NodeNet from "node:net";

import { assert, describe, it } from "@effect/vitest";
import type { EgressOpenFrame } from "@isnadi/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import { serveEgressControl, toEgressTarget } from "./DesktopEgress.ts";
import { denyAllHostPolicy as denyAll } from "./EgressDialer.ts";
import type { EgressRevocation } from "./EgressGrantStore.ts";
import { INBOUND_CHUNK_CAPACITY } from "./EgressLimits.ts";
import type { EgressSocketLink } from "./EgressWebSocket.ts";

const encode = (value: EgressOpenFrame | { readonly type: "nonsense" }) =>
  new TextEncoder().encode(JSON.stringify(value));

const makeControl = (frames: ReadonlyArray<Uint8Array>) => {
  const sent: Array<string> = [];

  const control: EgressSocketLink = {
    send: (data) =>
      Effect.sync(() => {
        sent.push(Predicate.isString(data) ? data : new TextDecoder().decode(data));
      }),
    // The socket stays open long enough for forked streams to answer, then closes.
    run: (onMessage) =>
      Effect.forEach(frames, (frame) => onMessage(frame, true), { discard: true }).pipe(
        Effect.andThen(Effect.forEach(Array.from({ length: 10 }), () => Effect.yieldNow)),
        Effect.asVoid,
      ),
    close: Effect.void,
  };

  return { control, sent };
};

const openStream = () => Effect.die("no stream should open");

describe("serveEgressControl", () => {
  it.effect("refuses a host with no grant before any TCP", () =>
    Effect.gen(function* () {
      const { control, sent } = makeControl([
        encode({
          type: "open",
          streamId: "s1",
          ticket: "t1",
          host: "example.com",
          port: 443,
          profileId: "p",
        }),
      ]);

      yield* serveEgressControl({
        control,
        openStream,
        hostPolicy: denyAll,
        revocations: Stream.empty,
      });

      assert.deepStrictEqual(
        sent.map((text) => JSON.parse(text)),
        [{ type: "refused", streamId: "s1", reason: "host-not-granted" }],
      );
    }),
  );

  it.effect("ignores frames that are not valid open frames", () =>
    Effect.gen(function* () {
      const { control, sent } = makeControl([
        encode({ type: "nonsense" }),
        new TextEncoder().encode("not json"),
      ]);

      yield* serveEgressControl({
        control,
        openStream,
        hostPolicy: denyAll,
        revocations: Stream.empty,
      });

      assert.deepStrictEqual(sent, []);
    }),
  );
});

/** A control socket that never closes on its own, so only the provider can end the connection. */
const makeHangingControl = (): EgressSocketLink => ({
  send: () => Effect.void,
  run: () => Effect.never,
  close: Effect.void,
});

describe("serveEgressControl backpressure (TASK-120)", () => {
  it.effect("pauses a peer that outruns the consumer and loses nothing", () =>
    Effect.gen(function* () {
      const socket = new NodeNet.Socket();
      const target = yield* toEgressTarget(socket);

      const chunks = Array.from(
        { length: INBOUND_CHUNK_CAPACITY + 4 },
        (_, index) => `chunk-${index}`,
      );

      for (const chunk of chunks) socket.emit("data", Buffer.from(chunk, "utf8"));

      assert.isTrue(socket.isPaused(), "the peer is paused once the queue is full");

      const received: Array<string> = [];

      const consumer = yield* Effect.forkChild(
        target.run((chunk) =>
          Effect.sync(() => {
            received.push(Buffer.from(chunk).toString("utf8"));
          }),
        ),
      );

      yield* Effect.forEach(chunks, () => Effect.yieldNow, { discard: true });
      socket.emit("close");
      yield* Fiber.join(consumer);

      assert.deepStrictEqual(received, chunks);
      assert.isFalse(socket.isPaused(), "the peer is read again once the consumer takes");
    }),
  );
});

describe("serveEgressControl on a grant change (TASK-120)", () => {
  it.effect("ends the connection when a profile leaves the binding", () =>
    // Returns only if the revocation ended the served connection; otherwise the test times out.
    serveEgressControl({
      control: makeHangingControl(),
      openStream,
      hostPolicy: denyAll,
      revocations: Stream.make({ profileId: "p" }),
    }),
  );

  it.effect("keeps the connection when only one host is revoked", () =>
    Effect.gen(function* () {
      const bus = yield* PubSub.unbounded<EgressRevocation>();
      const finished = yield* Deferred.make<void>();

      const served = yield* Effect.forkChild(
        serveEgressControl({
          control: makeHangingControl(),
          openStream,
          hostPolicy: denyAll,
          revocations: Stream.fromPubSub(bus),
        }).pipe(Effect.andThen(Deferred.succeed(finished, undefined))),
      );

      const settle = Effect.forEach(Array.from({ length: 10 }), () => Effect.yieldNow, {
        discard: true,
      });

      yield* PubSub.publish(bus, { profileId: "p", host: "example.com" });
      yield* settle;

      assert.isFalse(yield* Deferred.isDone(finished), "one host's revoke keeps the connection");

      yield* PubSub.publish(bus, { profileId: "p" });
      yield* settle;

      assert.isTrue(yield* Deferred.isDone(finished), "leaving the binding ends it");

      yield* Fiber.interrupt(served);
    }),
  );
});
