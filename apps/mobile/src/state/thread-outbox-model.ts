import { flow, Match, Predicate } from "effect";
import { isTransportConnectionErrorMessage } from "@isnadi/client-runtime/errors";
import type { EnvironmentShellStatus } from "@isnadi/client-runtime/state/shell";
import {
  CommandId,
  CommandRefusal,
  EnvironmentId,
  GroupAddressing,
  IsoDateTime,
  MessageId,
  ModelSelection,
  ProjectId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
  type CommandRefusal as CommandRefusalType,
  type GroupAddressing as GroupAddressingType,
  type ModelSelection as ModelSelectionType,
  type ProjectId as ProjectIdType,
  type ProviderInteractionMode as ProviderInteractionModeType,
  type RuntimeMode as RuntimeModeType,
} from "@isnadi/contracts";
import * as Schema from "effect/Schema";

import { DraftComposerImageAttachmentSchema } from "../lib/composer-image-schema";
import type { DraftComposerImageAttachment } from "../lib/composerImages";
import { scopedThreadKey } from "../lib/scopedEntities";

const THREAD_OUTBOX_SCHEMA_VERSION = 4;

const THREAD_OUTBOX_MAX_RETRY_DELAY_MS = 16_000;

const QueuedThreadCreationSchema = Schema.Struct({
  projectId: ProjectId,
  // Snapshot of the project's display metadata so a pending task stays
  // presentable in the thread list even when the project shell is not loaded.
  projectTitle: Schema.optional(Schema.String),
  projectCwd: Schema.optional(Schema.String),
  workspaceMode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

/**
 * Why a queued message was not delivered, kept on the message itself so the
 * item stays in the outbox and the reason survives a restart. `action` records
 * the decision the drain made, because a code this client cannot name has no
 * meaning on its own: only the decision says whether trying again could work.
 */
export const QueuedThreadFailureSchema = Schema.Struct({
  refusal: Schema.Union([CommandRefusal, Schema.Literal("unknown")]),
  action: Schema.Literals(["block", "discard"]),
  at: IsoDateTime,
});

export type QueuedThreadFailure = typeof QueuedThreadFailureSchema.Type;

export const QueuedThreadMessageSchema = Schema.Struct({
  schemaVersion: Schema.Literals([1, 2, 3, THREAD_OUTBOX_SCHEMA_VERSION]),
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  text: Schema.String,
  attachments: Schema.Array(DraftComposerImageAttachmentSchema),
  modelSelection: Schema.optional(ModelSelection),
  runtimeMode: Schema.optional(RuntimeMode),
  interactionMode: Schema.optional(ProviderInteractionMode),
  // Who a group chat message is for; absent in a direct chat or when the server routes it.
  addressing: Schema.optional(GroupAddressing),
  // Present when the queued item creates a brand-new thread (pending task)
  // instead of appending a turn to an existing one.
  creation: Schema.optional(QueuedThreadCreationSchema),
  // Present once a delivery failure stopped the item. The item stays queued so
  // the text is not lost, and the reason has to survive a restart to be worth
  // anything.
  failure: Schema.optional(QueuedThreadFailureSchema),
  createdAt: IsoDateTime,
});

const decodeStoredQueuedThreadMessage = Schema.decodeUnknownSync(QueuedThreadMessageSchema);

const encodeStoredQueuedThreadMessage = Schema.encodeUnknownSync(QueuedThreadMessageSchema);

export interface QueuedThreadCreation {
  readonly projectId: ProjectIdType;
  readonly projectTitle?: string;
  readonly projectCwd?: string;
  readonly workspaceMode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
}

export interface QueuedThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerImageAttachment>;
  readonly modelSelection?: ModelSelectionType;
  readonly runtimeMode?: RuntimeModeType;
  readonly interactionMode?: ProviderInteractionModeType;
  readonly addressing?: GroupAddressingType;
  readonly creation?: QueuedThreadCreation;
  readonly failure?: QueuedThreadFailure;
  readonly createdAt: string;
}

export interface ThreadSettingsSnapshot {
  readonly modelSelection: ModelSelectionType;
  readonly runtimeMode: RuntimeModeType;
  readonly interactionMode: ProviderInteractionModeType;
}

export function resolveQueuedThreadSettings(
  message: QueuedThreadMessage,
  thread: ThreadSettingsSnapshot,
): ThreadSettingsSnapshot {
  return {
    modelSelection: message.modelSelection ?? thread.modelSelection,
    runtimeMode: message.runtimeMode ?? thread.runtimeMode,
    interactionMode: message.interactionMode ?? thread.interactionMode,
  };
}

export function modelSelectionsEqual(left: ModelSelectionType, right: ModelSelectionType): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    JSON.stringify(left.options ?? null) === JSON.stringify(right.options ?? null)
  );
}

export function encodeQueuedThreadMessage(message: QueuedThreadMessage) {
  return encodeStoredQueuedThreadMessage({
    schemaVersion: THREAD_OUTBOX_SCHEMA_VERSION,
    ...message,
  });
}

export const decodeQueuedThreadMessage = flow(
  decodeStoredQueuedThreadMessage,
  ({ schemaVersion: _, ...message }): QueuedThreadMessage => message,
);

export function groupQueuedThreadMessages(messages: ReadonlyArray<QueuedThreadMessage>) {
  const deduplicated = new Map<MessageId, QueuedThreadMessage>();

  for (const message of messages) {
    deduplicated.set(message.messageId, message);
  }

  const grouped: Record<string, Array<QueuedThreadMessage>> = {};

  for (const message of deduplicated.values()) {
    const threadKey = scopedThreadKey(message.environmentId, message.threadId);
    (grouped[threadKey] ??= []).push(message);
  }

  for (const queue of Object.values(grouped)) {
    queue.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  return grouped;
}

export function flattenQueuedThreadMessages(
  queues: Record<string, ReadonlyArray<QueuedThreadMessage>>,
): ReadonlyArray<QueuedThreadMessage> {
  return Object.values(queues).flat();
}

export function threadOutboxRetryDelayMs(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), THREAD_OUTBOX_MAX_RETRY_DELAY_MS);
}

export type ThreadOutboxDeliveryAction = "wait" | "remove" | "send";

export function resolveThreadOutboxDeliveryAction(input: {
  readonly isCreation: boolean;
  readonly threadExists: boolean;
  readonly shellStatus: EnvironmentShellStatus;
  readonly environmentConnected: boolean;
  readonly threadBusy: boolean;
}): ThreadOutboxDeliveryAction {
  if (input.isCreation) {
    // A pending task creates its thread on delivery. If the thread already
    // exists the creation command went through and only cleanup remains.
    if (input.threadExists) {
      return "remove";
    }

    // Wait for the shell to be live before sending: until the thread list has
    // synchronized, a previously delivered creation whose cleanup failed would
    // look missing and get re-issued, duplicating the thread.
    return input.environmentConnected && input.shellStatus === "live" ? "send" : "wait";
  }

  if (!input.threadExists) {
    return input.shellStatus === "live" ? "remove" : "wait";
  }

  return input.environmentConnected ? "send" : "wait";
}

/**
 * A queued creation can only be dispatched once its payload would pass server
 * validation; incomplete payloads stay pending until the user edits them.
 */
export function isQueuedThreadCreationSendable(message: QueuedThreadMessage): boolean {
  if (!message.creation) {
    return false;
  }

  if (message.text.trim().length === 0 || message.modelSelection === undefined) {
    return false;
  }

  return message.creation.workspaceMode !== "worktree" || Boolean(message.creation.branch);
}

/**
 * A queued message that carries a recorded failure waits for the user: the
 * drain kept it with its reason precisely so it would not send itself later. A
 * message written at 09:00 must not land at 17:00 because someone finally fixed
 * the roster. The queue is ordered, so the thread waits with the held item.
 */
export function isQueuedThreadMessageHeld(message: QueuedThreadMessage): boolean {
  return message.failure !== undefined;
}

function errorMessage(cause: unknown): string | null {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (Predicate.isObjectOrArray(cause) && cause !== null && "message" in cause) {
    return Predicate.isString(cause.message) ? cause.message : null;
  }

  return Predicate.isString(cause) ? cause : null;
}

/**
 * Only a failure the server actually decided (`OrchestrationDispatchCommandError`,
 * or an authorization rejection) means the payload itself is bad. The other
 * typed failures a queued send can hit are transport-shaped: a socket that
 * dropped mid-request (`RpcClientError` wrapping a Socket read/write/close
 * reason), or an environment that is not connected or not registered. Those
 * are matched by tag, not by message text, because a `SocketReadError` message
 * is just "An error occurred during Read". A wrong answer here restores the
 * pending task into a draft and it disappears from the list.
 */
export function shouldRetryThreadOutboxDelivery(cause: unknown): boolean {
  if (Predicate.isObjectOrArray(cause) && cause !== null && "_tag" in cause) {
    const taggedDecision = Match.value(cause._tag).pipe(
      Match.when(
        Match.is("OrchestrationDispatchCommandError", "EnvironmentAuthorizationError"),
        () => false,
      ),
      Match.when(
        Match.is(
          "ConnectionTransientError",
          "RpcClientError",
          "EnvironmentRpcUnavailableError",
          "EnvironmentNotRegisteredError",
        ),
        () => true,
      ),
      Match.orElse(() => null),
    );

    if (taggedDecision !== null) return taggedDecision;
  }

  return isTransportConnectionErrorMessage(errorMessage(cause));
}

const THREAD_OUTBOX_HYDRATION_RETRY_DELAYS_MS = [250, 1_000, 4_000] as const;

export function threadOutboxHydrationRetryDelayMs(attempt: number): number | null {
  return THREAD_OUTBOX_HYDRATION_RETRY_DELAYS_MS[attempt] ?? null;
}

export type ThreadOutboxCommandStage = "settings-sync" | "start-turn";

const isCommandRefusal = Schema.is(CommandRefusal);

/**
 * Refusals whose condition clears without anyone changing anything, so the
 * queued item can keep using the normal backoff. Written down rather than
 * inferred from a code's name: a code added later is not in this set, so it
 * blocks — the user is told and nothing is lost, rather than retried forever.
 */
export const SELF_CLEARING_THREAD_OUTBOX_REFUSALS: ReadonlySet<CommandRefusalType> = new Set([
  "thread-is-busy",
]);

/**
 * The refusal code a squashed error carries, or null when it carries none.
 * Deliberately narrower than `classifyCommandFailure`, which folds "no code at
 * all" and "a code this client does not know" into one `unknown`: the drain
 * treats those differently, so the difference has to survive here.
 */
function readRefusal(cause: unknown): CommandRefusalType | "unknown" | null {
  const raw = Predicate.isObjectOrArray(cause) && "refusal" in cause ? cause.refusal : undefined;

  if (!Predicate.isString(raw)) {
    return null;
  }

  return isCommandRefusal(raw) ? raw : "unknown";
}

/** An auth refusal carries no refusal code, but needs a person just the same. */
function isAuthorizationFailure(cause: unknown): boolean {
  return Predicate.isTagged(cause, "EnvironmentAuthorizationError");
}

export type ThreadOutboxFailureAction = "retry" | "block" | "discard";

export type ThreadOutboxFailureDecision =
  | { readonly action: "retry" }
  | {
      readonly action: "block" | "discard";
      readonly refusal: CommandRefusalType | "unknown";
    };

export function resolveThreadOutboxFailureAction(input: {
  readonly stage: ThreadOutboxCommandStage;
  readonly error: unknown;
  readonly interrupted: boolean;
}): ThreadOutboxFailureDecision {
  const refusal = readRefusal(input.error);

  if (
    input.stage === "settings-sync" ||
    input.interrupted ||
    shouldRetryThreadOutboxDelivery(input.error) ||
    (refusal !== null && refusal !== "unknown" && SELF_CLEARING_THREAD_OUTBOX_REFUSALS.has(refusal))
  ) {
    return { action: "retry" };
  }

  if (isAuthorizationFailure(input.error)) {
    return { action: "block", refusal: "environment-rights" };
  }

  if (refusal !== null) {
    return { action: "block", refusal };
  }

  return { action: "discard", refusal: "unknown" };
}
