import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Headers from "effect/unstable/http/Headers";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import {
  type FromServer,
  type FromServerEncoded,
  RequestId,
  ResponseDefectEncoded,
  ResponseExitDieEncoded,
} from "effect/unstable/rpc/RpcMessage";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import {
  REDACTED_SERVER_DEFECT,
  redactServerDefects,
  safeWsRpcSerializationLayer,
} from "./wsDefectRedaction.ts";

const SECRET = "SECRET-MATERIAL-/home/alice/.ssh/id_rsa";

const encodeJson = (message: FromServerEncoded) =>
  String(RpcSerialization.json.makeUnsafe().encode(message));

/** The `defect` a client reads back off a defect envelope's JSON. */
const decodeWireDefect = Schema.decodeSync(Schema.Struct({ defect: Schema.Json }));

/** What a client's own RPC layer turns that `defect` back into: a plain `Error`. */
const decodeClientDefect = Schema.decodeSync(Schema.Defect());

const productionParser = Effect.map(RpcSerialization.RpcSerialization, (serialization) =>
  serialization.makeUnsafe(),
).pipe(Effect.provide(safeWsRpcSerializationLayer));

describe("redactServerDefects", () => {
  it("replaces the defect on a fatal-defect envelope", () => {
    const wire = JSON.parse(encodeJson(ResponseDefectEncoded(new Error(`boom ${SECRET}`))));

    assert.deepEqual(redactServerDefects(wire), {
      _tag: "Defect",
      defect: REDACTED_SERVER_DEFECT,
    });
  });

  it("replaces the defect in the Die branch of an exit", () => {
    const wire = JSON.parse(
      encodeJson(
        ResponseExitDieEncoded({ requestId: RequestId(1), defect: new Error(`boom ${SECRET}`) }),
      ),
    );

    assert.deepEqual(redactServerDefects(wire), {
      _tag: "Exit",
      requestId: 1,
      exit: {
        _tag: "Failure",
        cause: [{ _tag: "Die", defect: REDACTED_SERVER_DEFECT }],
      },
    });
  });

  it("leaves a declared error's Fail cause untouched", () => {
    const exit = {
      _tag: "Exit",
      requestId: 1,
      exit: {
        _tag: "Failure",
        cause: [{ _tag: "Fail", error: { _tag: "DeclaredError", message: "known failure" } }],
      },
    } as const;

    assert.deepEqual(redactServerDefects(exit), exit);
  });

  it("passes a non-defect envelope through unchanged", () => {
    const chunk = { _tag: "Chunk", requestId: 1, values: [1, 2, 3] } as const;

    assert.deepEqual(redactServerDefects(chunk), chunk);
  });
});

describe("the production WebSocket serialization", () => {
  it.effect("does not put a died handler's error text on the wire", () =>
    Effect.gen(function* () {
      const parser = yield* productionParser;

      const wire = String(parser.encode(ResponseDefectEncoded(new Error(`boom ${SECRET}`))));

      assert.notInclude(wire, SECRET);
      assert.notInclude(wire, "boom");
    }),
  );

  it.effect("does not put it on the wire through an exit's Die cause either", () =>
    Effect.gen(function* () {
      const parser = yield* productionParser;

      const wire = String(
        parser.encode(
          ResponseExitDieEncoded({ requestId: RequestId(1), defect: new Error(`boom ${SECRET}`) }),
        ),
      );

      assert.notInclude(wire, SECRET);
    }),
  );

  it.effect("hands the client a generic error it can still decode", () =>
    Effect.gen(function* () {
      const parser = yield* productionParser;

      const wire = String(parser.encode(ResponseDefectEncoded(new Error(`boom ${SECRET}`))));
      const { defect } = decodeWireDefect(JSON.parse(wire));

      assert.deepEqual(defect, REDACTED_SERVER_DEFECT);
      assert.instanceOf(decodeClientDefect(defect), Error);
    }),
  );
});

describe("a handler that dies", () => {
  const ProbeDie = Rpc.make("ProbeDie", { payload: Schema.Void, success: Schema.Void });

  const group = RpcGroup.make(ProbeDie);

  const handlers = group.toLayer({
    ProbeDie: () => Effect.die(new Error(`boom ${SECRET}`)),
  });

  it.effect("does not deliver its error text to the paired client", () =>
    Effect.gen(function* () {
      const received = yield* Deferred.make<FromServer<typeof ProbeDie>>();

      const server = yield* RpcServer.makeNoSerialization(group, {
        onFromServer: (response) => Deferred.succeed(received, response).pipe(Effect.asVoid),
      });

      yield* server.write(1, {
        _tag: "Request",
        id: RequestId(1),
        tag: "ProbeDie",
        payload: undefined,
        headers: Headers.empty,
      });

      const response = yield* Deferred.await(received);

      if (!Predicate.isTagged(response, "Defect")) {
        return assert.fail(`expected a Defect envelope, received ${response._tag}`);
      }

      // The envelope the server hands the transport, put through the production
      // serialization exactly as `Protocol.send` would.
      const parser = yield* productionParser;

      const wire = String(parser.encode(ResponseDefectEncoded(response.defect)));

      assert.notInclude(wire, SECRET);

      const { defect } = decodeWireDefect(JSON.parse(wire));

      assert.deepEqual(defect, REDACTED_SERVER_DEFECT);
      assert.instanceOf(decodeClientDefect(defect), Error);
    }).pipe(Effect.provide(handlers), Effect.scoped),
  );
});
