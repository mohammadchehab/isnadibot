import {
  isGroupBotMember,
  MessageId,
  WORK_ITEM_OPEN_LIMIT,
  type BotId,
  type ClientWorkItemCommand,
  type CommandId,
  type CommandRefusal,
  type GroupId,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type WorkItem,
  type WorkItemClaimCommand,
} from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import {
  internalInvariantError,
  refusedInvariantError,
  type OrchestrationCommandInvariantError,
} from "../Errors.ts";
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

export const isOpen = (item: WorkItem) => item.state !== "done" && item.state !== "closed";

const PROGRESS_SOURCES: ReadonlySet<WorkItem["state"]> = new Set([
  "assigned",
  "in-progress",
  "review",
  "blocked",
]);

const BLOCKABLE: ReadonlySet<WorkItem["state"]> = new Set(["assigned", "in-progress", "review"]);

/**
 * A refusal a person's board can reach, so it carries the code the client turns
 * into a sentence. The `detail` stays for the log and never becomes the toast.
 */
const reject = (command: WorkItemCommand, detail: string, refusal: CommandRefusal) =>
  refusedInvariantError({ commandType: command.type, detail, refusal });

/**
 * A refusal no person can produce, so there is no sentence to show. The reason
 * is required and stays server-side: it names the contract fact that closes the
 * guard, which is what stops a later reader from re-deriving the call.
 */
const rejectInternal = (command: WorkItemCommand, detail: string, reason: string) =>
  internalInvariantError({ commandType: command.type, detail, reason });

/**
 * The reason the four bot guards share. A bot actor arrives only through
 * `BotWorkItemCommand`, which is internal and built by the server after
 * resolving the bot from its own session; the person branch returns before
 * these guards, so no shipped surface can reach them.
 */
const BOT_ACTOR_ONLY =
  "A bot actor arrives only through the internal `BotWorkItemCommand`, which the server builds after resolving the bot from its own session; the person branch returns before these guards.";

/**
 * The reason the two claim guards share. `work-item.claim` is not in
 * `ClientWorkItemCommand`, so the contract cannot carry it, and the fleet
 * dispatcher is its only producer — it reads this invariant as `false` and
 * renders no sentence.
 */
const CLAIM_DISPATCHER_ONLY =
  "`work-item.claim` is absent from `ClientWorkItemCommand`, so the contract cannot carry it; the fleet dispatcher is its only producer and turns this invariant into `false` without rendering a sentence.";

function requireItem(
  readModel: OrchestrationReadModel,
  command: WorkItemCommand & { workItemId: WorkItem["id"] },
) {
  const item = readModel.workItems?.find((candidate) => candidate.id === command.workItemId);

  return item
    ? Effect.succeed(item)
    : Effect.fail(
        // The card was deleted elsewhere, so the board drew a view the server
        // has already left behind. Nothing about the card's state is in play.
        reject(command, `Work item '${command.workItemId}' does not exist.`, "stale-view"),
      );
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

  // The four guards below are R and A at once, so they carry no code: a bot
  // actor arrives only through `BotWorkItemCommand`, which is internal and built
  // by the server after resolving the bot from its own session. The person
  // branch returns above, so nobody can send these from outside and nobody who
  // can is a person.
  const botId = input.actor.botId;

  if (!isGroupMemberBot(input.group, botId)) {
    return Effect.fail(
      rejectInternal(
        input.command,
        `Bot '${botId}' is not in group '${input.group.id}'.`,
        BOT_ACTOR_ONLY,
      ),
    );
  }

  // A claim is a bot taking an item nobody owns yet, so ownership cannot gate it;
  // the claim branch decides whether the item is still takeable.
  if (input.command.type === "work-item.claim") return Effect.void;

  if (botId === input.group.bossBotId) return Effect.void;

  if (!MEMBER_BOT_COMMANDS.has(input.command.type)) {
    return Effect.fail(
      rejectInternal(
        input.command,
        `Only the boss of group '${input.group.id}' can run '${input.command.type}'.`,
        BOT_ACTOR_ONLY,
      ),
    );
  }

  // Dead arm with valid input. `work-item.update`, `.block` and `.unblock` all
  // require `workItemId` in the contract, and `work-item.create` — the only
  // command that reaches here with no item — is not in `MEMBER_BOT_COMMANDS`,
  // so it returned at the guard above. Nothing shipped can send this.
  if (input.item === undefined) {
    return Effect.fail(
      rejectInternal(
        input.command,
        `Bot '${botId}' has no work item to change.`,
        "Every command that reaches this guard carries `workItemId` in the contract, and `work-item.create` — the only one that would not — returns at the member-command guard above, so no input can leave `item` undefined here.",
      ),
    );
  }

  if (input.item.ownerBotId !== botId) {
    return Effect.fail(
      rejectInternal(
        input.command,
        `Bot '${botId}' neither owns work item '${input.item.id}' nor is its boss.`,
        BOT_ACTOR_ONLY,
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
      return yield* reject(
        command,
        `Work item '${command.workItemId}' already exists.`,
        "already-exists",
      );
    }

    if (
      items.filter((item) => item.groupId === group.id && isOpen(item)).length >=
      WORK_ITEM_OPEN_LIMIT
    ) {
      return yield* reject(
        command,
        `This space has ${WORK_ITEM_OPEN_LIMIT} open items. Close some first.`,
        "work-item-limit-reached",
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
      // A released item whose turn is still running is held by the dispatcher, not here: this
      // decider's read model is replayed through the legacy projector, which drops the turn's
      // trigger, so it cannot tell a live dispatcher turn from a settled one. The dispatcher reads
      // the DB-backed model and is the only producer of this command today — a second producer
      // would reopen the two-bots-on-one-item window this guard closes.
      // Both guards below are internal: R, not U. The dispatcher is the only
      // producer, and it swallows this invariant into a `false`
      // (`FleetDispatcherReactor.ts:130-135`), so no sentence is ever rendered
      // and there is nothing for the client to say.
      if (!isOpen(item))
        return yield* rejectInternal(
          command,
          "A finished item must be reopened first.",
          CLAIM_DISPATCHER_ONLY,
        );

      if (item.ownerBotId !== undefined || item.state !== "queued") {
        return yield* rejectInternal(
          command,
          `Work item '${item.id}' is already ${item.ownerBotId === undefined ? item.state : `taken by '${item.ownerBotId}'`}.`,
          CLAIM_DISPATCHER_ONLY,
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
      if (!isOpen(item))
        return yield* reject(
          command,
          "A finished item must be reopened first.",
          "work-item-state-invalid",
        );

      const cleared = carry(item, { owner: true, block: true });

      if (command.ownerBotId === null) {
        return yield* changed("work-item.assigned", { ...cleared, state: "queued", ...touch });
      }

      if (!isGroupMemberBot(group, command.ownerBotId)) {
        // The owner being assigned, not the actor: the person's owner picker
        // drew its roster from a view the server has already left behind, so
        // the remedy is the refresh `bot-not-a-group-member` names.
        return yield* reject(
          command,
          `Bot '${command.ownerBotId}' is not in group '${group.id}'.`,
          "bot-not-a-group-member",
        );
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
      if (!isOpen(item))
        return yield* reject(
          command,
          "A finished item must be reopened first.",
          "work-item-state-invalid",
        );

      if (command.state !== undefined && !PROGRESS_SOURCES.has(item.state)) {
        return yield* reject(
          command,
          `A ${item.state} item cannot move to ${command.state}.`,
          "work-item-state-invalid",
        );
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
        return yield* reject(
          command,
          `A ${item.state} item cannot be blocked.`,
          "work-item-state-invalid",
        );

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
        return yield* reject(
          command,
          "Only a blocked item can be unblocked.",
          "work-item-state-invalid",
        );

      return yield* changed("work-item.unblocked", {
        ...carry(item, { block: true }),
        state: item.blockedFrom ?? (item.ownerBotId !== undefined ? "assigned" : "queued"),
        ...touch,
      });
    }

    case "work-item.close": {
      // Another device closed it first. The card's new state is not the user's
      // next action here — there is nothing left to do with it — so the only
      // move is to look again, which is exactly `stale-view`.
      if (!isOpen(item))
        return yield* reject(command, `The item is already ${item.state}.`, "stale-view");
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
        return yield* reject(
          command,
          "Only a done or closed item can be reopened.",
          "work-item-state-invalid",
        );

      if (
        (readModel.workItems ?? []).filter(
          (candidate) => candidate.groupId === group.id && isOpen(candidate),
        ).length >= WORK_ITEM_OPEN_LIMIT
      ) {
        return yield* reject(
          command,
          `This space has ${WORK_ITEM_OPEN_LIMIT} open items. Close some first.`,
          "work-item-limit-reached",
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
