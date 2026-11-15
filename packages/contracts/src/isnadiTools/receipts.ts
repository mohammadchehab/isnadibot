import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  BotId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { IsnadiAwaitHandleId } from "./inputs.ts";
import { IsnadiToolApprovalClass } from "./catalog.ts";
import { CommandRefusal } from "../orchestration/refusals.ts";

export const IsnadiToolReceiptPhase = Schema.Literals([
  "start",
  "progress",
  "approval",
  "success",
  "failure",
  "cancellation",
]);

export const IsnadiToolFailureCode = Schema.Literals([
  "validation",
  "denied",
  "not_found",
  "timeout",
  "cancelled",
  "internal",
]);

export const IsnadiToolReceipt = Schema.Struct({
  receiptId: TrimmedNonEmptyString,
  toolId: TrimmedNonEmptyString,
  phase: IsnadiToolReceiptPhase,
  threadId: ThreadId,
  botId: Schema.optional(BotId),
  handleId: Schema.optional(IsnadiAwaitHandleId),
  summary: Schema.optional(TrimmedNonEmptyString),
  authorizationUrl: Schema.optional(TrimmedNonEmptyString),
  progress: Schema.optional(NonNegativeInt),
  approvalClass: Schema.optional(IsnadiToolApprovalClass),
  failureCode: Schema.optional(IsnadiToolFailureCode),
  /**
   * Why the command was refused, when the failure came from a decider refusal.
   * `failureCode` says the tool call was denied; this says which denial, so a
   * bot can tell "the squad is busy" from "that bot cannot take this" and act
   * on the difference.
   */
  refusal: Schema.optional(CommandRefusal),
  fatalToThread: Schema.Literal(false).pipe(
    Schema.withDecodingDefault(Effect.succeed(false as const)),
  ),
  billedBotId: Schema.optional(BotId),
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.optional(NonNegativeInt),
      outputTokens: Schema.optional(NonNegativeInt),
      costUsd: Schema.optional(Schema.Number),
    }),
  ),
  createdAt: IsoDateTime,
});

export type IsnadiToolReceipt = typeof IsnadiToolReceipt.Type;
