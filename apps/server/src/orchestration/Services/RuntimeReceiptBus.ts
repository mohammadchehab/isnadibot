/**
 * RuntimeReceiptBus - Internal checkpoint-reactor synchronization receipts.
 *
 * This service exists to expose short-lived orchestration milestones that are
 * useful in tests and harnesses but are not part of the production runtime
 * event model. `CheckpointReactor` publishes receipts such as baseline capture,
 * diff finalization, and turn-processing quiescence so integration tests can
 * wait for those exact points without inferring them indirectly from persisted
 * state.
 *
 * Production code should only call `publish`. Test code may subscribe via
 * `streamEventsForTest`, which is intentionally named to make the intended
 * usage explicit.
 *
 * @module RuntimeReceiptBus
 */
import {
  BotId,
  CheckpointRef,
  GroupId,
  IsoDateTime,
  NonNegativeInt,
  ThreadId,
  TurnId,
  WorkItemId,
} from "@isnadi/contracts";
import * as Schema from "effect/Schema";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";

export const CheckpointBaselineCapturedReceipt = Schema.Struct({
  type: Schema.Literal("checkpoint.baseline.captured"),
  threadId: ThreadId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  createdAt: IsoDateTime,
});

export type CheckpointBaselineCapturedReceipt = typeof CheckpointBaselineCapturedReceipt.Type;

export const CheckpointDiffFinalizedReceipt = Schema.Struct({
  type: Schema.Literal("checkpoint.diff.finalized"),
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  checkpointRef: CheckpointRef,
  status: Schema.Literals(["ready", "missing", "error"]),
  createdAt: IsoDateTime,
});

export type CheckpointDiffFinalizedReceipt = typeof CheckpointDiffFinalizedReceipt.Type;

export const TurnProcessingQuiescedReceipt = Schema.Struct({
  type: Schema.Literal("turn.processing.quiesced"),
  threadId: ThreadId,
  turnId: TurnId,
  checkpointTurnCount: NonNegativeInt,
  createdAt: IsoDateTime,
});

export type TurnProcessingQuiescedReceipt = typeof TurnProcessingQuiescedReceipt.Type;

/**
 * One decision the keep-busy dispatcher made for a group. `assigned` means an item went to a bot
 * and a turn started with its brief; every other kind records why nothing was handed out, so a
 * test can wait for the exact decision instead of for a sleep.
 */
export const FleetDispatchDecidedReceipt = Schema.Struct({
  type: Schema.Literal("fleet.dispatch.decided"),
  groupId: GroupId,
  kind: Schema.Literals(["assigned", "boss-woken", "owner-notified", "skipped"]),
  itemId: Schema.optional(WorkItemId),
  botId: Schema.optional(BotId),
  reason: Schema.optional(
    Schema.Literals(["queue-empty", "no-idle-member", "no-chat", "claim-lost", "turn-running"]),
  ),
  createdAt: IsoDateTime,
});

export type FleetDispatchDecidedReceipt = typeof FleetDispatchDecidedReceipt.Type;

export const OrchestrationRuntimeReceipt = Schema.Union([
  CheckpointBaselineCapturedReceipt,
  CheckpointDiffFinalizedReceipt,
  TurnProcessingQuiescedReceipt,
  FleetDispatchDecidedReceipt,
]);

export type OrchestrationRuntimeReceipt = typeof OrchestrationRuntimeReceipt.Type;

export interface RuntimeReceiptBusShape {
  readonly publish: (receipt: OrchestrationRuntimeReceipt) => Effect.Effect<void>;
  readonly streamEventsForTest: Stream.Stream<OrchestrationRuntimeReceipt>;
  readonly subscribeEventsForTest?: Effect.Effect<
    Stream.Stream<OrchestrationRuntimeReceipt>,
    never,
    Scope.Scope
  >;
}

export class RuntimeReceiptBus extends Context.Service<RuntimeReceiptBus, RuntimeReceiptBusShape>()(
  "isnadibot/orchestration/Services/RuntimeReceiptBus",
) {}
