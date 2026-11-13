import {
  isGroupBotMember,
  MessageId,
  WORK_ITEM_OPEN_LIMIT,
  type BotId,
  type ClientWorkItemCommand,
  type CommandId,
  type GroupId,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type WorkItem,
  type WorkItemClaimCommand,
} from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import { requireGroup, requireGroupWorkItemMutationAuthorized } from "../commandInvariants.ts";
import { type PlannedOrchestrationEvent, nowIso, withEventBase } from "./eventBase.ts";

/**
 * Who is issuing the command. A client is always a person; a bot arrives only
 * through the server-built `work-item.bot-act` wrapper, never from a payload.
 */
type WorkItemActor =
  | { readonly kind: "user"; readonly dispatch: OrchestrationDispatchActor | undefined }
  | { readonly kind: "bot"; readonly botId: BotId };

type WorkItemCommand = ClientWorkItemCommand | WorkItemClaimCommand;

/** A member bot may only move its own item forward; everything else is the boss's call. */
const MEMBER_BOT_COMMANDS: ReadonlySet<WorkItemCommand["type"]> = new Set([
  "work-item.update",
  "work-item.block",
  "work-item.unblock",
]);

const isOpen = (item: WorkItem) => item.state !== "done" && item.state !== "closed";

const PROGRESS_SOURCES: ReadonlySet<WorkItem["state"]> = new Set([
  "assigned",
  "in-progress",
  "review",
  "blocked",
]);

const BLOCKABLE: ReadonlySet<WorkItem["state"]> = new Set(["assigned", "in-progress", "review"]);

const reject = (command: WorkItemCommand, detail: string) =>
  new OrchestrationCommandInvariantError({ commandType: command.type, detail });

function requireItem(
  readModel: OrchestrationReadModel,
  command: WorkItemCommand & { workItemId: WorkItem["id"] },
) {
  const item = readModel.workItems?.find((candidate) => candidate.id === command.workItemId);

  return item
    ? Effect.succeed(item)
    : Effect.fail(reject(command, `Work item '${command.workItemId}' does not exist.`));
}

function isGroupMemberBot(group: OrchestrationGroup, botId: BotId) {
  return group.members.some((member) => isGroupBotMember(member) && member.botId === botId);
}

/**
 * A bot changes only its own items, and a member only by moving them through
 * `update`, `block` and `unblock`; the boss changes anything. A person needs
 * group access.
 */
function requireActorAllowed(input: {
  readonly command: WorkItemCommand;
  readonly group: OrchestrationGroup;
  readonly item: WorkItem | undefined;
  readonly actor: WorkItemActor;
}) {
  if (input.actor.kind === "user") {
    return requireGroupWorkItemMutationAuthorized({
      command: input.command,
      group: input.group,
      actor: input.actor.dispatch,
    });
  }

  const botId = input.actor.botId;

  if (!isGroupMemberBot(input.group, botId)) {
    return Effect.fail(
      reject(input.command, `Bot '${botId}' is not in group '${input.group.id}'.`),
    );
  }

  // A claim is a bot taking an item nobody owns yet, so ownership cannot gate it;
  // the claim branch decides whether the item is still takeable.
  if (input.command.type === "work-item.claim") return Effect.void;

  if (botId === input.group.bossBotId) return Effect.void;

  if (!MEMBER_BOT_COMMANDS.has(input.command.type)) {
    return Effect.fail(
      reject(
        input.command,
        `Only the boss of group '${input.group.id}' can run '${input.command.type}'.`,
      ),
    );
  }

  if (input.item === undefined) {
    return Effect.fail(reject(input.command, `Bot '${botId}' has no work item to change.`));
  }

  if (input.item.ownerBotId !== botId) {
    return Effect.fail(
      reject(
        input.command,
        `Bot '${botId}' neither owns work item '${input.item.id}' nor is its boss.`,
      ),
    );
  }

  return Effect.void;
}

/** The item's carried-over fields; each transition decides which of owner, block and finish data survive. */
function carry(
  item: WorkItem,
  drop: { readonly owner?: boolean; readonly block?: boolean; readonly finish?: boolean },
): Omit<WorkItem, "state" | "updatedAt"> {
  return {
    id: item.id,
    groupId: item.groupId,
    title: item.title,
    brief: item.brief,
    kind: item.kind,
    createdAt: item.createdAt,
    ...(item.role !== undefined ? { role: item.role } : {}),
    ...(item.trackerLink !== undefined ? { trackerLink: item.trackerLink } : {}),
    ...(item.threadId !== undefined ? { threadId: item.threadId } : {}),
    ...(item.prUrl !== undefined ? { prUrl: item.prUrl } : {}),
    ...(!drop.owner && item.ownerBotId !== undefined ? { ownerBotId: item.ownerBotId } : {}),
    ...(!drop.owner && item.assignedByBotId !== undefined
      ? { assignedByBotId: item.assignedByBotId }
      : {}),
    ...(!drop.block && item.blockedOn !== undefined ? { blockedOn: item.blockedOn } : {}),
    ...(!drop.block && item.blockedFrom !== undefined ? { blockedFrom: item.blockedFrom } : {}),
    ...(!drop.finish && item.doneAt !== undefined ? { doneAt: item.doneAt } : {}),
    ...(!drop.finish && item.closedAt !== undefined ? { closedAt: item.closedAt } : {}),
  };
}

/**
 * The owner can vanish mid-flight: an unassigned, archived or deleted bot leaves
 * its open items unowned and back in the queue, and each item's chat says why.
 * Finished items keep their owner for history.
 *
 * `groupId` narrows the sweep to the group the bot just left; without it the bot
 * is gone from every group, so every item it owns is released. The chat line goes
 * to the item's own chat because that is where its work happens; an item nobody
 * picked up has no chat, so it is released silently.
 */
export const clearOwnedWorkItems = Effect.fn("clearOwnedWorkItems")(function* ({
  readModel,
  botId,
  occurredAt,
  commandId,
  groupId,
}: {
  readonly readModel: OrchestrationReadModel;
  readonly botId: BotId;
  readonly occurredAt: string;
  readonly commandId: CommandId;
  readonly groupId?: GroupId;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  PlatformError.PlatformError,
  Crypto.Crypto
> {
  const botName = readModel.bots.find((bot) => bot.id === botId)?.name ?? botId;
  const events: PlannedOrchestrationEvent[] = [];

  const orphaned = (readModel.workItems ?? []).filter(
    (item) =>
      item.ownerBotId === botId &&
      isOpen(item) &&
      (groupId === undefined || item.groupId === groupId),
  );

  for (const item of orphaned) {
    events.push({
      ...(yield* withEventBase({
        aggregateKind: "work-item",
        aggregateId: item.id,
        occurredAt,
        commandId,
      })),
      type: "work-item.assigned",
      payload: {
        workItem: {
          ...carry(item, { owner: true, block: true }),
          state: "queued",
          updatedAt: occurredAt,
        },
      },
    });

    const thread =
      item.threadId === undefined
        ? undefined
        : readModel.threads.find((candidate) => candidate.id === item.threadId);

    if (thread === undefined || thread.deletedAt !== null) continue;

    events.push({
      ...(yield* withEventBase({
        aggregateKind: "thread",
        aggregateId: thread.id,
        occurredAt,
        commandId,
      })),
      type: "thread.message-sent",
      payload: {
        threadId: thread.id,
        // Deterministic, so a retried command cannot post the line twice.
        messageId: MessageId.make(`work-item-owner-cleared:${item.id}`),
        role: "system",
        text: `${botName} left, so "${item.title}" is back in the queue.`,
        turnId: null,
        streaming: false,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      },
    });
  }

  return events;
});

export const decideWorkItems = Effect.fn("decideWorkItems")(function* ({
  command,
  commandId,
  readModel,
  actor,
}: {
  readonly command: WorkItemCommand;
  /** The dispatched command's id; a bot wrapper tags its events with its own id. */
  readonly commandId: CommandId;
  readonly readModel: OrchestrationReadModel;
  readonly actor: WorkItemActor;
}): Effect.fn.Return<
  ReadonlyArray<PlannedOrchestrationEvent>,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  const occurredAt = yield* nowIso;

  const changed = Effect.fn(function* (
    type: Extract<PlannedOrchestrationEvent["type"], `work-item.${string}`>,
    workItem: WorkItem,
  ) {
    const base = yield* withEventBase({
      aggregateKind: "work-item",
      aggregateId: workItem.id,
      occurredAt,
      commandId,
    });

    // SAFETY: every non-deleted work-item event type carries `{ workItem }`, which is what `type` is limited to here.
    return [{ ...base, type, payload: { workItem } } as PlannedOrchestrationEvent];
  });

  if (command.type === "work-item.create") {
    const group = yield* requireGroup({ readModel, command, groupId: command.groupId });
    yield* requireActorAllowed({ command, group, item: undefined, actor });
    const items = readModel.workItems ?? [];

    if (items.some((item) => item.id === command.workItemId)) {
      return yield* reject(command, `Work item '${command.workItemId}' already exists.`);
    }

    if (
      items.filter((item) => item.groupId === group.id && isOpen(item)).length >=
      WORK_ITEM_OPEN_LIMIT
    ) {
      return yield* reject(
        command,
        `This space has ${WORK_ITEM_OPEN_LIMIT} open items. Close some first.`,
      );
    }

    return yield* changed("work-item.created", {
      id: command.workItemId,
      groupId: group.id,
      title: command.title,
      brief: command.brief,
      kind: command.kind,
      ...(command.role !== undefined ? { role: command.role } : {}),
      ...(command.trackerLink !== undefined ? { trackerLink: command.trackerLink } : {}),
      state: "queued",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });
  }

  const item = yield* requireItem(readModel, command);
  const group = yield* requireGroup({ readModel, command, groupId: item.groupId });
  yield* requireActorAllowed({ command, group, item, actor });
  const touch = { updatedAt: occurredAt };

  switch (command.type) {
    case "work-item.claim": {
      if (!isOpen(item)) return yield* reject(command, "A finished item must be reopened first.");

      if (item.ownerBotId !== undefined || item.state !== "queued") {
        return yield* reject(
          command,
          `Work item '${item.id}' is already ${item.ownerBotId === undefined ? item.state : `taken by '${item.ownerBotId}'`}.`,
        );
      }

      // The bot took the item itself, so no `assignedByBotId` is recorded.
      return yield* changed("work-item.assigned", {
        ...carry(item, { owner: true, block: true }),
        ownerBotId: command.botId,
        state: "assigned",
        ...touch,
      });
    }

    case "work-item.assign": {
      if (!isOpen(item)) return yield* reject(command, "A finished item must be reopened first.");

      const cleared = carry(item, { owner: true, block: true });

      if (command.ownerBotId === null) {
        return yield* changed("work-item.assigned", { ...cleared, state: "queued", ...touch });
      }

      if (!isGroupMemberBot(group, command.ownerBotId)) {
        return yield* reject(command, `Bot '${command.ownerBotId}' is not in group '${group.id}'.`);
      }

      return yield* changed("work-item.assigned", {
        ...cleared,
        ownerBotId: command.ownerBotId,
        ...(actor.kind === "bot" ? { assignedByBotId: actor.botId } : {}),
        state: "assigned",
        ...touch,
      });
    }

    case "work-item.update": {
      if (!isOpen(item)) return yield* reject(command, "A finished item must be reopened first.");

      if (command.state !== undefined && !PROGRESS_SOURCES.has(item.state)) {
        return yield* reject(command, `A ${item.state} item cannot move to ${command.state}.`);
      }

      const moved = carry(item, { block: command.state !== undefined });

      return yield* changed("work-item.updated", {
        ...moved,
        state: command.state ?? item.state,
        ...(command.title !== undefined ? { title: command.title } : {}),
        ...(command.brief !== undefined ? { brief: command.brief } : {}),
        ...(command.threadId !== undefined ? { threadId: command.threadId } : {}),
        ...(command.prUrl !== undefined ? { prUrl: command.prUrl } : {}),
        ...touch,
      });
    }

    case "work-item.block": {
      if (!BLOCKABLE.has(item.state))
        return yield* reject(command, `A ${item.state} item cannot be blocked.`);

      return yield* changed("work-item.blocked", {
        ...item,
        state: "blocked",
        blockedFrom: item.state,
        blockedOn: command.blockedOn,
        ...touch,
      });
    }

    case "work-item.unblock": {
      if (item.state !== "blocked")
        return yield* reject(command, "Only a blocked item can be unblocked.");

      return yield* changed("work-item.unblocked", {
        ...carry(item, { block: true }),
        state: item.blockedFrom ?? (item.ownerBotId !== undefined ? "assigned" : "queued"),
        ...touch,
      });
    }

    case "work-item.close": {
      if (!isOpen(item)) return yield* reject(command, `The item is already ${item.state}.`);
      const open = carry(item, { block: true });

      return yield* changed(
        "work-item.closed",
        command.resolution === "done"
          ? { ...open, state: "done", doneAt: occurredAt, ...touch }
          : { ...open, state: "closed", closedAt: occurredAt, ...touch },
      );
    }

    case "work-item.reopen": {
      if (isOpen(item))
        return yield* reject(command, "Only a done or closed item can be reopened.");

      if (
        (readModel.workItems ?? []).filter(
          (candidate) => candidate.groupId === group.id && isOpen(candidate),
        ).length >= WORK_ITEM_OPEN_LIMIT
      ) {
        return yield* reject(
          command,
          `This space has ${WORK_ITEM_OPEN_LIMIT} open items. Close some first.`,
        );
      }

      return yield* changed("work-item.reopened", {
        ...carry(item, { finish: true }),
        state: item.ownerBotId !== undefined ? "assigned" : "queued",
        ...touch,
      });
    }
  }
});
