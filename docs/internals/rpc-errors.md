# The RPC error channel

> For maintainers. Using IsnadiBot? See [docs/user](../user/).

Every client request travels the same Effect RPC WebSocket. When one fails, exactly one of two
channels carries the failure back, and they are not interchangeable: **a declared cause crosses to
the client, a defect never does.** This document records that boundary, because it is invisible in
the handler you are writing and easy to re-open by accident.

## The two channels

**A declared (`Fail`) cause crosses.** A handler fails with one of the errors its RPC declares, and
the server encodes the exit through that RPC's own schema — `encodeExit` at
`.repos/effect-smol/packages/effect/src/unstable/rpc/RpcServer.ts:611`. That is the channel a caller
may rely on: the fields are structured (`reason`, `operation`, `detail`, a path), the client decodes
them, and the refusal codes in [refusals](./refusals.md) ride it. TASK-394 (#315) removed
`Schema.Defect()` from every wire error class that declared one — 28 `cause` fields across 12 files in
`packages/contracts`; where the underlying failure is the only diagnostic it is kept as a native
`Error.cause` through `withCause`
(`packages/contracts/src/errorCause.ts`), a property no schema encodes, so a log reads it and the
wire never does.

**A defect never crosses.** A handler that dies — a throw, an `Effect.die`, a bug — reaches a client
by two routes, and both are scrubbed. `RpcServer.sendDefect` (`RpcServer.ts:444`) builds a
`{ _tag: "Defect", clientId, defect }` envelope and hands `defect` through untouched; `RpcMessage`
then encodes it with `Schema.encodeSync(Schema.Defect())` (`RpcMessage.ts:326`). The second route is
the `Die` branch of an exit, reached by `sendDefect(client, Cause.squash(exit.cause))`
(`RpcServer.ts:303`).

## Where it is closed

`apps/server/src/wsDefectRedaction.ts` is the one place. `redactServerDefects` replaces a
fatal-defect envelope's `defect`, and every `Die` cause of an exit, with `REDACTED_SERVER_DEFECT` —
`name: "ServerDefect"`, `message: "Internal server error"` — carrying none of the thrown error's
name, message or cause chain. `safeWsRpcSerializationLayer` wraps `RpcSerialization.json` so the scrub
runs inside the serialization's `encode`, and `apps/server/src/ws.ts` provides that layer to
`RpcServer.toHttpEffectWebsocket` — the only paired-client entry point, which is what makes the
envelope the right seam.

Two properties make the envelope the only seam that works:

- **A handler cannot opt a defect back onto the wire by declaring a `defectSchema`.** The per-RPC
  schema exists (`RpcServer.ts:612`), but `sendDefect` never reads it: it encodes with
  `Schema.Defect()` unconditionally. Declaring one changes nothing on this path.
- **The encoded exit cause is flat.** `ExitEncoded`'s failure cause is a
  `ReadonlyArray<Fail | Die | Interrupt>` (`RpcMessage.ts:261`) with no nested `Cause` below the top
  level, so mapping the redaction over the array reaches every `Die` and nothing can hide underneath
  it.

## What it does not do

Scrubbing is a **wire** boundary, not a logging one. `RpcServer` reports the defect before the
serialization runs, so the real name, message and cause chain still reach the server log. Defects are
unobservable _to a client_; they are not unobservable.

## Why a schema census is not enough

`packages/contracts/src/wireDefectCause.test.ts` walks the real error schema of every WebSocket
request and fails if a `Defect` reappears on any of them. It already carries a control of its own: a
second case feeds the walker an error that puts `cause: Schema.optional(Schema.Defect())` back and
asserts the walker finds it.

**That census was green while the defect channel was still wide open.** The control proves the
walker works; it cannot prove the channel is covered, because the census reads each RPC's declared
error schema and `sendDefect` never reads that schema. A control that exercises the detector is not a
control for the path the defect actually takes. **A test is evidence for a channel only when the same
path can fail it** — so the scrub carries its own tests
(`apps/server/src/wsDefectRedaction.test.ts`), one per route the defect travels: the fatal-defect
envelope, the `Die` branch of an exit, the declared `Fail` cause that must stay untouched, and a
non-defect envelope that must pass through. Removing the scrub fails six of those eight.

When you add a guard to a channel, prove it is load-bearing by removing it once and watching the
test go red. A guard whose test stays green without it is documentation, not a guard.

## When you add an RPC

- Declare the errors a client must act on as the RPC's error schema. That is the crossing channel,
  and its fields are public the moment they ship.
- Never put `Schema.Defect()` in a wire error schema. The census test will catch it; the reason is
  that it encodes the failure's name, message and cause chain.
- If a handler needs the raw failure for a log, attach it with `withCause`, not with a schema field.
- Do not try to make a defect's shape nicer per RPC. `sendDefect` ignores `defectSchema`, and the
  envelope scrub replaces whatever it encodes.
