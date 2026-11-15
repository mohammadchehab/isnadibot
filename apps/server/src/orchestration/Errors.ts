import * as SchemaIssue from "effect/SchemaIssue";
import * as Schema from "effect/Schema";

import { CommandRefusal } from "@isnadi/contracts";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";

export class OrchestrationCommandJsonParseError extends Schema.TaggedErrorClass<OrchestrationCommandJsonParseError>()(
  "OrchestrationCommandJsonParseError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Invalid orchestration command JSON: ${this.detail}`;
  }
}

export class OrchestrationCommandDecodeError extends Schema.TaggedErrorClass<OrchestrationCommandDecodeError>()(
  "OrchestrationCommandDecodeError",
  {
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Invalid orchestration command payload: ${this.issue}`;
  }
}

/** The detail of the invariant error for a command whose decision was "nothing to do". */
export const COMMAND_PRODUCED_NO_EVENTS = "Command produced no events.";

/**
 * The two claims a throw without a refusal code can make. They are separate
 * labels because they expire differently: `internal-command` is closed by the
 * contract — the command that reaches it is not one a client can dispatch, its
 * schema rejects the input, or the dispatch path always supplies the argument
 * the guard requires — so it cannot become reachable without a contract change.
 * `no-shipped-surface` is only closed by what shipped clients send today and
 * ends the moment a surface adds a control. One label for both would let the
 * second hide under the first, and nothing re-reads a row filed under the wrong
 * one.
 */
export const InvariantExclusion = Schema.Struct({
  /**
   * `internal-command`: a client cannot dispatch it, its schema rejects the
   * input, or the dispatch path always supplies what the guard requires.
   * `no-shipped-surface`: it can, and none does.
   */
  kind: Schema.Literals(["internal-command", "no-shipped-surface"]),
  reason: Schema.String,
});

export class OrchestrationCommandInvariantError extends Schema.TaggedErrorClass<OrchestrationCommandInvariantError>()(
  "OrchestrationCommandInvariantError",
  {
    commandType: Schema.String,
    detail: Schema.String,
    /** Why the command was refused, when a client has a dedicated path for it. */
    refusal: Schema.optional(CommandRefusal),
    /**
     * Why this throw carries no refusal code, written at the throw by
     * `internalInvariantError` or `noShippedSurfaceInvariantError`. Never crosses
     * the wire: `toDispatchCommandError` copies only `message` and `refusal`, so
     * this stays server-side for the log and for a test.
     */
    exclusion: Schema.optional(InvariantExclusion),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Orchestration command invariant failed (${this.commandType}): ${this.detail}`;
  }
}

/**
 * An invariant no client command can reach — a server bug, not a user
 * situation. `reason` names the contract fact that closes it (the command is
 * server-internal, or its schema rejects the input at decode), so a later reader
 * never re-derives the call or wonders whether the missing code was an
 * oversight. Use `noShippedSurfaceInvariantError` when a client *can* dispatch
 * the command and only the shipped surfaces happen not to.
 */
export function internalInvariantError(input: {
  readonly commandType: string;
  readonly detail: string;
  readonly reason: string;
}): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType: input.commandType,
    detail: input.detail,
    exclusion: { kind: "internal-command", reason: input.reason },
  });
}

/**
 * An invariant a client can dispatch but no shipped surface reaches. The
 * contract permits the input, so this exclusion expires the moment a surface
 * offers the control: `reason` names the surface and what it sends instead,
 * which is what a later reader needs in order to notice the button that changes
 * the answer.
 */
export function noShippedSurfaceInvariantError(input: {
  readonly commandType: string;
  readonly detail: string;
  readonly reason: string;
}): OrchestrationCommandInvariantError {
  return new OrchestrationCommandInvariantError({
    commandType: input.commandType,
    detail: input.detail,
    exclusion: { kind: "no-shipped-surface", reason: input.reason },
  });
}

export class OrchestrationCommandPreviouslyRejectedError extends Schema.TaggedErrorClass<OrchestrationCommandPreviouslyRejectedError>()(
  "OrchestrationCommandPreviouslyRejectedError",
  {
    commandId: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Command previously rejected (${this.commandId}): ${this.detail}`;
  }
}

export class OrchestrationCommandIdConflictError extends Schema.TaggedErrorClass<OrchestrationCommandIdConflictError>()(
  "OrchestrationCommandIdConflictError",
  {
    commandId: Schema.String,
    receiptAggregateKind: Schema.String,
    receiptAggregateId: Schema.String,
    commandAggregateKind: Schema.String,
    commandAggregateId: Schema.String,
  },
) {
  override get message(): string {
    return `Command id '${this.commandId}' already used for ${this.receiptAggregateKind} '${this.receiptAggregateId}'; refusing to replay its receipt for ${this.commandAggregateKind} '${this.commandAggregateId}'.`;
  }
}

export class OrchestrationProjectorDecodeError extends Schema.TaggedErrorClass<OrchestrationProjectorDecodeError>()(
  "OrchestrationProjectorDecodeError",
  {
    eventType: Schema.String,
    issue: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Projector decode failed for ${this.eventType}: ${this.issue}`;
  }
}

export class OrchestrationListenerCallbackError extends Schema.TaggedErrorClass<OrchestrationListenerCallbackError>()(
  "OrchestrationListenerCallbackError",
  {
    listener: Schema.Literals(["read-model", "domain-event"]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Orchestration ${this.listener} listener failed: ${this.detail}`;
  }
}

export type OrchestrationDispatchError =
  | ProjectionRepositoryError
  | OrchestrationCommandInvariantError
  | OrchestrationCommandIdConflictError
  | OrchestrationCommandPreviouslyRejectedError
  | OrchestrationProjectorDecodeError
  | OrchestrationListenerCallbackError;

export type OrchestrationEngineError =
  | OrchestrationDispatchError
  | OrchestrationCommandJsonParseError
  | OrchestrationCommandDecodeError;

export function toProjectorDecodeError(eventType: string) {
  return (error: Schema.SchemaError): OrchestrationProjectorDecodeError =>
    new OrchestrationProjectorDecodeError({
      eventType,
      issue: SchemaIssue.makeFormatterDefault()(error.issue),
      cause: error,
    });
}
