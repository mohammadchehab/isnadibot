import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as NodeHttp from "node:http";

import { postBrowserSession } from "./serverTestClients.ts";

/**
 * Proves the bootstrap POST survives a server that is not accepting yet, which
 * is what a starved accept queue looks like from the client: a connect refused
 * or timed out on loopback, never a wrong answer.
 *
 * A closed loopback port refuses immediately, so the delayed start below is
 * deterministic and fast — no ten-second connect timeout is waited out.
 *
 * Both cases run on the live clock (`it.live`): they wait on real sockets and on
 * the retry's real backoff, and the test clock would never let either elapse.
 */
const reserveClosedPort = Effect.promise(async () => {
  const probe = NodeHttp.createServer();

  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));

  const address = probe.address();

  await new Promise<void>((resolve) => probe.close(() => resolve()));

  if (address === null || Predicate.isString(address)) {
    throw new Error("Expected the probe to bind a TCP port");
  }

  return address.port;
});

const closeServer = (server: NodeHttp.Server) =>
  Effect.promise<void>(() => new Promise((resolve) => server.close(() => resolve())));

const listenOn = (server: NodeHttp.Server, port: number) =>
  Effect.promise<void>(() => new Promise((resolve) => server.listen(port, "127.0.0.1", resolve)));

const originFor = (port: number) => `http://127.0.0.1:${port}`;

const bootstrapUrlFor = (port: number) => `${originFor(port)}/api/auth/browser-session`;

/**
 * The suites reach the test server through a client that carries its base URL,
 * because `fetchEffect` reduces a request to its path. These tests talk to a
 * server of their own, so they supply the matching origin the same way.
 */
const clientForOrigin = (origin: string) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.mapRequest(client, HttpClientRequest.prependUrl(origin)),
    ),
  ).pipe(Layer.provide(FetchHttpClient.layer));

const sessionBody = JSON.stringify({
  authenticated: true,
  sessionMethod: "bootstrap",
  expiresAt: "2026-11-15T13:00:00.000Z",
});

it.live("recovers when the bootstrap server starts a moment after the first attempt", () =>
  reserveClosedPort.pipe(
    Effect.flatMap((port) =>
      Effect.gen(function* () {
        const server = NodeHttp.createServer((_request, response) => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(sessionBody);
        });

        yield* Effect.addFinalizer(() => closeServer(server));

        // Nothing listens on the first attempt; the server is up before the
        // first backoff elapses, so the retry finds it.
        yield* listenOn(server, port).pipe(Effect.delay("50 millis"), Effect.forkScoped);

        const response = yield* postBrowserSession(bootstrapUrlFor(port), "credential");

        assert.equal(response.status, 200);
      }).pipe(Effect.provide(clientForOrigin(originFor(port))), Effect.scoped),
    ),
  ),
);

it.live("gives up on a bounded budget when the server never starts", () =>
  reserveClosedPort.pipe(
    Effect.flatMap((port) =>
      Effect.gen(function* () {
        const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);

        const result = yield* Effect.result(
          postBrowserSession(bootstrapUrlFor(port), "credential"),
        );

        const elapsed = (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) - startedAt;

        const failure = Result.isFailure(result) ? result.failure : undefined;

        assert.isTrue(Predicate.isTagged(failure, "TestHttpRequestError"));
        // Three attempts against a refusing port, plus two short backoffs.
        assert.isBelow(elapsed, 5_000);
      }).pipe(Effect.provide(clientForOrigin(originFor(port))), Effect.scoped),
    ),
  ),
);
