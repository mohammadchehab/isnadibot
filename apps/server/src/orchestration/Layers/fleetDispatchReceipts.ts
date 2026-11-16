import {
  CommandId,
  EventId,
  FLEET_DISPATCH_CLAIM_ACTIVITY,
  FLEET_DISPATCH_IDLE_ACTIVITY,
  type FleetDispatchClaimPayload,
  type GroupId,
  type IsoDateTime,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type WorkItem,
} from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";

import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";

/**
 * A `thread.activity.append` command. The dispatcher builds one of these and
 * dispatches it itself, so the builders below stay a pure read of the model
 * they are handed.
 */
type ThreadActivityAppendCommand = Extract<
  OrchestrationCommand,
  { readonly type: "thread.activity.append" }
>;

/**
 * The group's own chat: the thread a message to the group is written into.
 *
 * A chat belongs to a bot or to a group, never both, so `botId` being unset is
 * what tells the group's chat apart from a member's chat filed in the same
 * space. Archived and deleted chats are not where the group reads, so they are
 * not where a note belongs.
 */
export function groupChatThread(
  readModel: OrchestrationReadModel,
  groupId: GroupId,
): OrchestrationThread | undefined {
  return readModel.threads
    .filter(
      (thread) =>
        thread.groupId === groupId &&
        thread.botId == null &&
        thread.parentThreadId == null &&
        thread.deletedAt === null &&
        thread.archivedAt === null,
    )
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id),
    )[0];
}

/**
 * Whether the group's chat already ends on an idle note.
 *
 * The dispatcher looks at an empty queue after every turn end, so a note
 * written each time would be a row per turn. The note is news once: after work
 * was handed out and the queue emptied again. Reading the chat's own activities
 * makes that durable, so a restart does not repeat what the user already read.
 */
export function idleAlreadyNoted(thread: OrchestrationThread): boolean {
  const fleetNotes = thread.activities
    .filter(
      (activity) =>
        activity.kind === FLEET_DISPATCH_CLAIM_ACTIVITY ||
        activity.kind === FLEET_DISPATCH_IDLE_ACTIVITY,
    )
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));

  return fleetNotes.at(-1)?.kind === FLEET_DISPATCH_IDLE_ACTIVITY;
}

const appendCommand = (input: {
  readonly readModel: OrchestrationReadModel;
  readonly groupId: GroupId;
  readonly receiptId: string;
  readonly kind: string;
  readonly summary: string;
  readonly payload: unknown;
  readonly createdAt: IsoDateTime;
}): ThreadActivityAppendCommand | undefined => {
  const thread = groupChatThread(input.readModel, input.groupId);

  // No chat to write in yet: a group whose queue moved before anyone opened it.
  // Inventing one here would put a chat in the sidebar nobody asked for.
  if (thread === undefined) return undefined;

  return {
    type: "thread.activity.append",
    commandId: CommandId.make(`server:fleet-dispatch:${input.receiptId}`),
    threadId: thread.id,
    activity: {
      id: EventId.make(`fleet-dispatch:${input.receiptId}`),
      tone: "info",
      kind: input.kind,
      summary: input.summary,
      payload: input.payload,
      turnId: null,
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
  };
};

/**
 * Writes the note into the group's chat.
 *
 * A note is a courtesy row: the work is claimed either way, so a refused or
 * failed append is logged and the hand-out stands rather than unwinding it.
 */
const note = (engine: OrchestrationEngineShape, command: ThreadActivityAppendCommand | undefined) =>
  command === undefined
    ? Effect.void
    : engine.dispatch(command).pipe(
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("fleet dispatcher could not note a dispatch in the group chat", {
                threadId: command.threadId,
                kind: command.activity.kind,
                cause: Cause.pretty(cause),
              }),
        ),
      );

/** "{botName} was idle, so the board gave it "{itemTitle}"." */
export const noteDispatchClaim = (
  engine: OrchestrationEngineShape,
  input: {
    readonly readModel: OrchestrationReadModel;
    readonly groupId: GroupId;
    readonly bot: OrchestrationBot;
    readonly item: WorkItem;
    readonly createdAt: IsoDateTime;
  },
) => {
  const payload: FleetDispatchClaimPayload = {
    botId: input.bot.id,
    botName: input.bot.name,
    workItemId: input.item.id,
    itemTitle: input.item.title,
  };

  return note(
    engine,
    appendCommand({
      readModel: input.readModel,
      groupId: input.groupId,
      // One hand-out is one moment, so the item and its time are the receipt.
      receiptId: `claim:${input.item.id}:${input.createdAt}`,
      kind: FLEET_DISPATCH_CLAIM_ACTIVITY,
      summary: `${input.bot.name} was idle, so the board gave it "${input.item.title}".`,
      payload,
      createdAt: input.createdAt,
    }),
  );
};

/**
 * "Everyone is idle and the board is empty." Nothing to say when the chat has
 * already said it since the last hand-out.
 */
export const noteDispatchIdle = (
  engine: OrchestrationEngineShape,
  input: {
    readonly readModel: OrchestrationReadModel;
    readonly groupId: GroupId;
    readonly createdAt: IsoDateTime;
  },
) => {
  const thread = groupChatThread(input.readModel, input.groupId);

  if (thread === undefined || idleAlreadyNoted(thread)) return Effect.void;

  return note(
    engine,
    appendCommand({
      ...input,
      // The moment is what makes this note distinct from the next one.
      receiptId: `idle:${input.createdAt}`,
      kind: FLEET_DISPATCH_IDLE_ACTIVITY,
      summary: "Everyone is idle and the board is empty.",
      payload: {},
    }),
  );
};
