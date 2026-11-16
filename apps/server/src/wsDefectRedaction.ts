import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import type { ExitEncoded, FromServerEncoded } from "effect/unstable/rpc/RpcMessage";
import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";

/**
 * What a paired client sees in place of a server-internal defect. It carries no
 * name, message, or cause chain from the thrown error; the real cause stays in
 * the server log, where `RpcServer` reports it.
 */
export const REDACTED_SERVER_DEFECT = {
  name: "ServerDefect",
  message: "Internal server error",
} as const;

type ExitCause = Extract<
  ExitEncoded<unknown, unknown>,
  { readonly _tag: "Failure" }
>["cause"][number];

const redactCause = (cause: ExitCause): ExitCause =>
  Predicate.isTagged(cause, "Die") ? { ...cause, defect: REDACTED_SERVER_DEFECT } : cause;

const redactExit = (exit: ExitEncoded<unknown, unknown>): ExitEncoded<unknown, unknown> =>
  Predicate.isTagged(exit, "Failure") ? { ...exit, cause: exit.cause.map(redactCause) } : exit;

/**
 * Replaces every server-internal defect on an outgoing RPC envelope with
 * `REDACTED_SERVER_DEFECT`.
 *
 * This is the wire boundary and the one place that closes the defect channel.
 * A handler that dies reaches a client by two routes: the fatal-defect envelope
 * (`ResponseDefectEncoded`) and the `Die` branch of an exit. Both pass through
 * here, so neither can serialize an arbitrary `Error`. It deliberately does not
 * use a per-RPC `defectSchema`: `RpcServer`'s `sendDefect` ignores that schema
 * and encodes with `Schema.Defect()` unconditionally. Declared (`Fail`) errors
 * are left untouched, so the separate declared-error channel that #315 closed
 * stays closed.
 */
export const redactServerDefects = (message: FromServerEncoded): FromServerEncoded =>
  Predicate.isTagged(message, "Defect")
    ? { ...message, defect: REDACTED_SERVER_DEFECT }
    : Predicate.isTagged(message, "Exit")
      ? { ...message, exit: redactExit(message.exit) }
      : message;

const redactDefects = (
  base: RpcSerialization.RpcSerialization["Service"],
): RpcSerialization.RpcSerialization["Service"] =>
  RpcSerialization.RpcSerialization.of({
    contentType: base.contentType,
    includesFraming: base.includesFraming,
    makeUnsafe: () => {
      const parser = base.makeUnsafe();

      return {
        decode: parser.decode,
        encode: (response) => {
          // SAFETY: Effect types `Parser.encode` as `unknown`, but the RPC server
          // only ever hands it an encoded server envelope.
          const envelope = response as FromServerEncoded;

          return parser.encode(redactServerDefects(envelope));
        },
      };
    },
  });

/**
 * The JSON serialization the environment server uses on the WebSocket, with
 * every outgoing envelope scrubbed of server-internal defect text. Use this in
 * place of `RpcSerialization.layerJson` wherever the server accepts paired
 * clients.
 */
export const safeWsRpcSerializationLayer: Layer.Layer<RpcSerialization.RpcSerialization> =
  Layer.succeed(RpcSerialization.RpcSerialization)(redactDefects(RpcSerialization.json));
