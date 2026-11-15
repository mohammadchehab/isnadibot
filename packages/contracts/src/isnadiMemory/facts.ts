import * as Schema from "effect/Schema";
import {
  BotId,
  GroupId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import {
  ISNADI_MEMORY_PACKET_MAX_FACTS,
  ISNADI_MEMORY_PACKET_MAX_CHARS,
  ISNADI_MEMORY_PACKET_MAX_ESTIMATED_TOKENS,
  IsnadiMemoryRootId,
  IsnadiMemoryTenantId,
  IsnadiMemoryUserId,
  IsnadiMemoryScope,
  IsnadiMemoryApprovalState,
  IsnadiMemoryTargetScope,
  IsnadiMemoryDeletionState,
  IsnadiMemoryKind,
  IsnadiMemoryConfidence,
  IsnadiMemoryRevision,
  IsnadiMemoryCandidateDecision,
  IsnadiMemoryDecisionReceipt,
} from "./base.ts";
import { IsnadiMemoryArchiveTarget } from "./transfer.ts";

export const IsnadiMemoryMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("candidate.decide"),
    decision: IsnadiMemoryCandidateDecision,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.edit"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
    fact: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.pin"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
    pinned: Schema.Boolean,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.scope"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
    scope: IsnadiMemoryTargetScope,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.decide"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
    decision: Schema.Literals(["approve", "reject"]),
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.forget"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
  }),
  Schema.Struct({
    operation: Schema.Literal("fact.delete"),
    memoryId: IsnadiMemoryRootId,
    expectedRevision: PositiveInt,
  }),
  Schema.Struct({ operation: Schema.Literal("conversation.clear") }),
]);

export type IsnadiMemoryMutation = typeof IsnadiMemoryMutation.Type;

export const IsnadiMemoryMutateInput = Schema.Struct({
  threadId: ThreadId,
  mutation: IsnadiMemoryMutation,
});

export type IsnadiMemoryMutateInput = typeof IsnadiMemoryMutateInput.Type;

export const IsnadiMemoryMutationResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("candidate"), receipt: IsnadiMemoryDecisionReceipt }),
  Schema.Struct({ kind: Schema.Literal("revision"), revision: IsnadiMemoryRevision }),
  Schema.Struct({ kind: Schema.Literal("deleted"), memoryId: IsnadiMemoryRootId }),
  Schema.Struct({ kind: Schema.Literal("conversation-cleared") }),
]);

export type IsnadiMemoryMutationResult = typeof IsnadiMemoryMutationResult.Type;

export const IsnadiMemoryFactsListInput = Schema.Struct({
  threadId: ThreadId,
  target: IsnadiMemoryArchiveTarget,
});

export type IsnadiMemoryFactsListInput = typeof IsnadiMemoryFactsListInput.Type;

export const IsnadiMemoryFactRead = Schema.Struct({
  rootId: IsnadiMemoryRootId,
  fact: TrimmedNonEmptyString,
  scope: IsnadiMemoryScope,
  sourceThreadId: Schema.NullOr(ThreadId),
  affectedBotIds: Schema.Array(BotId),
  approvalState: IsnadiMemoryApprovalState,
  deletionState: IsnadiMemoryDeletionState,
  pinned: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  revision: PositiveInt,
  supersededFact: Schema.NullOr(Schema.String),
});

export type IsnadiMemoryFactRead = typeof IsnadiMemoryFactRead.Type;

export const IsnadiMemoryFactsListResult = Schema.Struct({
  facts: Schema.Array(IsnadiMemoryFactRead),
});

export type IsnadiMemoryFactsListResult = typeof IsnadiMemoryFactsListResult.Type;

/**
 * The memory operations a failure can name. Every producer on the memory RPCs
 * reports one of these, so the copy below can be exhaustive: a new operation is
 * a compile error rather than a silent fall through to a vague sentence.
 */
export const IsnadiMemoryOperation = Schema.Literals([
  "archive.applyImport",
  "archive.export",
  "archive.previewImport",
  "document.replace",
  "documents.export",
  "documents.importApply",
  "documents.importPreview",
  "documents.inspect",
  "facts.list",
  "facts.mutate",
  "observations.clear",
]);

export type IsnadiMemoryOperation = typeof IsnadiMemoryOperation.Type;

/**
 * The sentence a memory failure shows the user, per operation. `detail` is the
 * raw cause and can carry a filesystem path or an internal id, so it stays a
 * log field and never becomes copy. No value here names a path, an id, a raw
 * operation or a cause.
 *
 * Operations that are the same user situation share a sentence rather than each
 * minting one, the way the settings failures do.
 */
export const ISNADI_MEMORY_FAILURE_COPY: Record<IsnadiMemoryOperation, string> = {
  "archive.applyImport": "The memory could not be imported.",
  "archive.export": "The memory could not be exported.",
  "archive.previewImport": "The memory import could not be previewed.",
  "document.replace": "The memory could not be saved.",
  "documents.export": "The memory could not be exported.",
  "documents.importApply": "The memory could not be imported.",
  "documents.importPreview": "The memory import could not be previewed.",
  "documents.inspect": "The memory could not be read.",
  "facts.list": "The memory could not be read.",
  "facts.mutate": "The memory could not be saved.",
  "observations.clear": "The chat summary could not be cleared.",
};

/**
 * The authored conditions a memory failure can name. Unlike `operation`, which
 * says what the user was doing, a reason says what was wrong, and each of these
 * five has its own remedy — reopen memory, turn memory on, or ask whoever runs
 * the environment to restore approvals. That closed set is why they are literals
 * here instead of a message the producer fills in.
 */
export const IsnadiMemoryFailureReason = Schema.Literals([
  "memory-changed",
  "bot-changed",
  "memory-off",
  "memory-unavailable",
  "approvals-unavailable",
]);

export type IsnadiMemoryFailureReason = typeof IsnadiMemoryFailureReason.Type;

/**
 * The sentence each authored condition shows. These are the sentences the
 * server already wrote for these five conditions, kept verbatim so a reason
 * changes where the copy lives and not what the user reads.
 */
const ISNADI_MEMORY_REASON_COPY: Record<IsnadiMemoryFailureReason, string> = {
  "memory-changed": "Memory changed since you opened it. Reopen memory before saving.",
  "bot-changed": "The active bot changed. Reopen memory before saving.",
  "memory-off": "Memory is turned off.",
  "memory-unavailable": "Memory is unavailable.",
  "approvals-unavailable": "Memory approvals are unavailable.",
};

/**
 * A memory request that failed, carrying the sentence the user reads.
 *
 * The message picks between two cause shapes, and which one applies is a
 * property of the cause set, not a preference:
 *
 * - `reason` is a closed union of authored conditions, so it is a literal union
 *   and its copy is exhaustive — a new condition is a compile error.
 * - `operation` is the eleven memory operations, likewise closed, and its copy
 *   is exhaustive for the same reason.
 *
 * When a producer's cause set is instead open — a portability archive failure
 * can say anything — the message travels as a plain `message` field the producer
 * fills, the way `PortabilityArchiveError` does. A declared field that the
 * server is merely trusted to fill correctly is not a guarantee, so it is only
 * used where no closed set exists.
 *
 * `detail` is the raw cause. It can carry a filesystem path or an internal id,
 * so it stays a log field and never becomes copy.
 */
export class IsnadiMemoryOperationError extends Schema.TaggedErrorClass<IsnadiMemoryOperationError>()(
  "IsnadiMemoryOperationError",
  {
    operation: IsnadiMemoryOperation,
    reason: Schema.optional(IsnadiMemoryFailureReason),
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.reason === undefined
      ? ISNADI_MEMORY_FAILURE_COPY[this.operation]
      : ISNADI_MEMORY_REASON_COPY[this.reason];
  }
}

export const IsnadiMemoryPacketFact = Schema.Struct({
  memoryId: IsnadiMemoryRootId,
  expectedRevision: PositiveInt,
  scope: IsnadiMemoryScope,
  kind: IsnadiMemoryKind,
  fact: TrimmedNonEmptyString,
  pinned: Schema.Boolean,
  confidence: IsnadiMemoryConfidence,
  updatedAt: IsoDateTime,
});

export type IsnadiMemoryPacketFact = typeof IsnadiMemoryPacketFact.Type;

export const IsnadiMemoryPacket = Schema.Struct({
  threadId: ThreadId,
  facts: Schema.Array(IsnadiMemoryPacketFact).check(
    Schema.isMaxLength(ISNADI_MEMORY_PACKET_MAX_FACTS),
  ),
  estimatedTokens: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(ISNADI_MEMORY_PACKET_MAX_ESTIMATED_TOKENS),
  ),
  rendered: Schema.String.check(Schema.isMaxLength(ISNADI_MEMORY_PACKET_MAX_CHARS)),
});

export type IsnadiMemoryPacket = typeof IsnadiMemoryPacket.Type;

export const IsnadiMemoryThreadAccess = Schema.Struct({
  tenantId: IsnadiMemoryTenantId,
  userId: IsnadiMemoryUserId,
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  legacyWorkspaceOwnerProjectId: Schema.optional(ProjectId),
  botId: Schema.NullOr(BotId),
  groupId: Schema.NullOr(GroupId),
  respondingBotId: Schema.NullOr(BotId),
  groupMemberBotIds: Schema.Array(BotId),
});

export type IsnadiMemoryThreadAccess = typeof IsnadiMemoryThreadAccess.Type;
