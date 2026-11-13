import {
  BotId,
  CommandId,
  type FleetRoleId,
  GroupId,
  MessageId,
  WorkItemId,
  isGroupBotMember,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ThreadId,
  type TurnId,
  type WorkItem,
} from "@isnadi/contracts";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../../serverActivation.ts";
import { COMMAND_PRODUCED_NO_EVENTS, OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  FleetDispatcherReactor,
  type FleetDispatcherReactorShape,
} from "../Services/FleetDispatcherReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";

/** Why a group was left exactly as it was. */
type SkipReason = "queue-empty" | "no-idle-member" | "role-holder-busy" | "no-chat" | "claim-lost";

/** The state an item holds while its owner is expected to be working on it. */
const HELD_ITEM_STATES: ReadonlySet<WorkItem["state"]> = new Set([
  "assigned",
  "in-progress",
  "blocked",
]);

/** A session in one of these states still has a turn in flight for its bot. */
const LIVE_SESSION_STATUSES: ReadonlySet<string> = new Set(["running", "starting"]);

/**
 * Runs a keep-busy group: when one of its members stops running a turn, or a queued item
 * arrives, the dispatcher hands the oldest waiting item to a member that has nothing to do. The
 * decision is plain code — no model call ever routes work — and the item is taken through the
 * server-internal `work-item.claim`, so two groups that race for the same item cannot both win.
 *
 * A restart leaves the teams empty-handed: no turn ends for an already idle member, so start
 * reads every keep-busy group once.
 */
const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const runtimeReceiptBus = yield* RuntimeReceiptBus;
  const crypto = yield* Crypto.Crypto;

  // Groups whose queue is worth a look. A burst of turn ends and work-item events for one group
  // collapses into one decision; the decision reads the read model fresh, so a stale trigger
  // cannot hand the same item out twice.
  const pending = yield* Ref.make<ReadonlySet<GroupId>>(new Set());

  // The turn a thread last started, so the session leaving "running" can name the turn that just
  // ended even though the session no longer carries it.
  const lastTurnId = new Map<ThreadId, TurnId>();

  // The turn end already acted on for a thread. A turn end reaches us twice — the diff
  // completing, then the session leaving "running" — and a replay can deliver both again.
  const handledTurnEnd = new Map<ThreadId, string>();

  const publishDecision = (
    groupId: GroupId,
    kind: "assigned" | "skipped",
    fields: {
      readonly itemId?: WorkItemId;
      readonly botId?: BotId;
      readonly reason?: SkipReason;
    },
  ) =>
    DateTime.now.pipe(
      Effect.flatMap((now) =>
        runtimeReceiptBus.publish({
          type: "fleet.dispatch.decided",
          groupId,
          kind,
          ...(fields.itemId === undefined ? {} : { itemId: fields.itemId }),
          ...(fields.botId === undefined ? {} : { botId: fields.botId }),
          ...(fields.reason === undefined ? {} : { reason: fields.reason }),
          createdAt: DateTime.formatIso(now),
        }),
      ),
    );

  const dispatchCommand = (
    what: string,
    build: (input: {
      readonly commandId: CommandId;
      readonly createdAt: string;
    }) => OrchestrationCommand,
  ) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            orchestrationEngine.dispatch(
              build({
                commandId: CommandId.make(`server:${what}:${uuid}`),
                createdAt: DateTime.formatIso(now),
              }),
            ),
          ),
        ),
      ),
      Effect.asVoid,
      // A decider that finds nothing to do is a normal outcome, not a failure.
      Effect.catchIf(
        (error) => isInvariantError(error) && error.detail === COMMAND_PRODUCED_NO_EVENTS,
        () => Effect.logDebug("fleet dispatcher command had nothing to do", { what }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher command failed", {
              what,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // The claim is the only authority on who owns the item: it rejects when another group took the
  // item first, and that rejection is exactly the race this guard exists for.
  const claim = (botId: BotId, itemId: WorkItemId) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            orchestrationEngine.dispatch({
              type: "work-item.claim",
              commandId: CommandId.make(`server:work-item.claim:${uuid}`),
              botId,
              workItemId: itemId,
              createdAt: DateTime.formatIso(now),
            }),
          ),
        ),
      ),
      Effect.as(true),
      Effect.catchIf(
        (error) => isInvariantError(error),
        () => Effect.succeed(false),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not claim a work item", {
              botId,
              itemId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(false)),
      ),
    );

  const startTurn = (thread: OrchestrationThread, item: WorkItem) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        dispatchCommand("dispatcher-turn", ({ commandId, createdAt }) => ({
          type: "thread.turn.start",
          commandId,
          threadId: thread.id,
          message: {
            messageId: MessageId.make(`dispatcher:${uuid}`),
            role: "user",
            text: dispatchBrief(item),
            attachments: [],
          },
          // AC6: the chat's own runtime mode, never a raised one.
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
          createdAt,
        })),
      ),
    );

  // Hands out as many waiting items as the group has idle members. A claim changes neither the
  // read model in hand nor the read model's view of who is free, so both are kept current here.
  const dispatchGroup = (readModel: OrchestrationReadModel, group: OrchestrationGroup) =>
    Effect.gen(function* () {
      const waiting = queuedWorkItems(readModel, group.id);
      const busied = new Set<BotId>();
      const reported = yield* Ref.make(false);

      if (waiting.length === 0)
        return yield* publishDecision(group.id, "skipped", { reason: "queue-empty" });

      // One skip receipt per pass, and only while the pass has handed nothing out: the item that
      // could not go decides the reason, and the rest of the queue is still tried.
      const skip = (item: WorkItem, reason: SkipReason) =>
        Ref.getAndSet(reported, true).pipe(
          Effect.flatMap((already) =>
            already || busied.size > 0
              ? Effect.void
              : publishDecision(group.id, "skipped", { itemId: item.id, reason }),
          ),
        );

      for (const item of waiting) {
        const pick = pickIdleMember(readModel, group, {
          ...(item.role === undefined ? {} : { role: item.role }),
          busy: busied,
        });

        if (pick.kind !== "picked") {
          yield* skip(
            item,
            pick.kind === "role-holder-busy" ? "role-holder-busy" : "no-idle-member",
          );

          continue;
        }

        const bot = pick.bot;
        const chat = botChat(readModel, bot.id);

        if (chat === undefined) {
          yield* publishDecision(group.id, "skipped", {
            itemId: item.id,
            botId: bot.id,
            reason: "no-chat",
          });

          return;
        }

        if (!(yield* claim(bot.id, item.id))) {
          yield* publishDecision(group.id, "skipped", {
            itemId: item.id,
            botId: bot.id,
            reason: "claim-lost",
          });

          return;
        }

        yield* startTurn(chat, item);
        yield* publishDecision(group.id, "assigned", { itemId: item.id, botId: bot.id });
        busied.add(bot.id);
      }
    });

  const sweep = (groupIds: ReadonlyArray<GroupId>) =>
    projectionSnapshotQuery.getCommandReadModel().pipe(
      Effect.flatMap((readModel) =>
        Effect.forEach(
          groupIds,
          (groupId) => {
            const group = readModel.groups.find((candidate) => candidate.id === groupId);

            return group !== undefined && group.keepBusy === true
              ? dispatchGroup(readModel, group)
              : Effect.void;
          },
          { discard: true },
        ),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not read a group", {
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // Takes the groups queued since the last pass and decides each of them once.
  const processPending = Effect.gen(function* () {
    const groups = yield* Ref.getAndSet(pending, new Set());
    const groupIds = Array.from(groups);

    if (groupIds.length === 0) return;

    yield* sweep(groupIds);
  });

  const worker = yield* makeDrainableWorker(() => processPending);
  const seenSequence = yield* SubscriptionRef.make(0);
  // Completes once every keep-busy group has been read and queued after a restart.
  const restored = yield* Deferred.make<void>();

  const noteSeen = (sequence: number) =>
    SubscriptionRef.update(seenSequence, (seen) => Math.max(seen, sequence));

  const schedule = (groupId: GroupId) =>
    Ref.update(pending, (groups) =>
      groups.has(groupId) ? groups : new Set([...groups, groupId]),
    ).pipe(Effect.andThen(worker.enqueue(undefined)));

  // A thread's group: its own for a group chat, or the group of the bot that owns the chat.
  const groupOfThread = (
    readModel: OrchestrationReadModel,
    threadId: ThreadId,
  ): GroupId | undefined => {
    const thread = readModel.threads.find(
      (candidate) => candidate.id === threadId && candidate.deletedAt === null,
    );

    const groupId = thread?.groupId;

    if (groupId !== undefined && groupId !== null) return groupId;

    const botId = thread?.botId;

    if (botId === null || botId === undefined) return undefined;

    return readModel.bots.find((bot) => bot.id === botId)?.groupId ?? undefined;
  };

  // The event names a thread or a group, but only the read model says which group that is — and
  // the decision that follows reads the read model anyway.
  const scheduleAfterRead = (groupId: GroupId | undefined, threadId?: ThreadId) =>
    groupId !== undefined
      ? schedule(groupId)
      : projectionSnapshotQuery.getCommandReadModel().pipe(
          Effect.flatMap((readModel) => {
            const found = threadId === undefined ? undefined : groupOfThread(readModel, threadId);

            return found === undefined ? Effect.void : schedule(found);
          }),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("fleet dispatcher could not resolve a group", {
                  cause: Cause.pretty(cause),
                }),
          ),
        );

  const turnEnded = (threadId: ThreadId, turnId: TurnId | string) => {
    if (handledTurnEnd.get(threadId) === turnId) return Effect.void;

    handledTurnEnd.set(threadId, turnId);

    return scheduleAfterRead(undefined, threadId);
  };

  const observe = (event: OrchestrationEvent) => {
    switch (event.type) {
      case "thread.turn-diff-completed":
        return turnEnded(event.payload.threadId, event.payload.turnId);

      case "thread.session-set": {
        const { threadId, session } = event.payload;

        if (session.activeTurnId !== null) {
          lastTurnId.set(threadId, session.activeTurnId);

          return Effect.void;
        }

        return LIVE_SESSION_STATUSES.has(session.status)
          ? Effect.void
          : turnEnded(threadId, lastTurnId.get(threadId) ?? `event:${event.sequence}`);
      }

      case "group.keep-busy-set":
        return event.payload.keepBusy ? schedule(event.payload.groupId) : Effect.void;

      case "work-item.created":
      case "work-item.assigned":
      case "work-item.updated":
      case "work-item.blocked":
      case "work-item.unblocked":
      case "work-item.closed":
      case "work-item.reopened":
        return schedule(event.payload.workItem.groupId);

      case "work-item.deleted":
        return schedule(event.payload.groupId);

      default:
        return Effect.void;
    }
  };

  // Every group that asked to be kept busy, so an idle team is dispatched after a restart too.
  const restoreGroups = projectionSnapshotQuery.getCommandReadModel().pipe(
    Effect.flatMap((readModel) =>
      Effect.forEach(
        readModel.groups.filter((group) => group.keepBusy === true),
        (group) => schedule(group.id),
        { discard: true },
      ),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning("fleet dispatcher could not restore keep-busy groups", {
            cause: Cause.pretty(cause),
          }),
    ),
    Effect.ensuring(Deferred.succeed(restored, undefined)),
  );

  const drainRestored = Deferred.await(restored).pipe(Effect.andThen(worker.drain));

  const start: FleetDispatcherReactorShape["start"] = Effect.fn("start")(function* () {
    // Subscribe before reading so no event between the read and the first delivery is missed.
    // A duplicate pass is harmless: the decision reads the read model and the claim rejects.
    const domainEvents = yield* orchestrationEngine.subscribeDomainEvents;
    yield* forkParked(
      Stream.runForEach(domainEvents, (event) =>
        observe(event).pipe(Effect.andThen(noteSeen(event.sequence))),
      ),
    );
    yield* forkParked(restoreGroups);
  });

  const drainThrough: FleetDispatcherReactorShape["drainThrough"] = Effect.fn(
    "FleetDispatcherReactor.drainThrough",
  )(function* (target) {
    yield* SubscriptionRef.changes(seenSequence).pipe(
      Stream.filter((seen) => seen >= target),
      Stream.runHead,
    );
    yield* drainRestored;
  });

  return { start, drain: drainRestored, drainThrough } satisfies FleetDispatcherReactorShape;
});

const isInvariantError = Schema.is(OrchestrationCommandInvariantError);

/** The brief a bot wakes up to: the item's title, then its body. */
export function dispatchBrief(item: WorkItem): string {
  const brief = item.brief.trim();

  return brief.length === 0 ? item.title : `${item.title}\n\n${brief}`;
}

/** The group's queued items, oldest first, with a stable tie-break on the id. */
export function queuedWorkItems(
  readModel: OrchestrationReadModel,
  groupId: GroupId,
): ReadonlyArray<WorkItem> {
  return (readModel.workItems ?? [])
    .filter(
      (item) =>
        item.groupId === groupId && item.state === "queued" && item.ownerBotId === undefined,
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
}

/** The chat a bot works in: its own, most recently active one first. */
export function botChat(
  readModel: OrchestrationReadModel,
  botId: BotId,
): OrchestrationThread | undefined {
  return readModel.threads
    .filter(
      (thread) => thread.botId === botId && thread.deletedAt === null && thread.archivedAt === null,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/**
 * A bot with nothing to do: nothing running for it and no item it is expected to be working on.
 *
 * AC3 replaces this with `@isnadi/shared/botStatus` (TASK-83), which also knows about a pending
 * approval or question and about work waiting on children — neither is in the command read model.
 */
export function isBotIdle(readModel: OrchestrationReadModel, botId: BotId): boolean {
  const bot = readModel.bots.find((candidate) => candidate.id === botId);

  if (bot === undefined || bot.archivedAt !== null) return false;

  const holdingAnItem = (readModel.workItems ?? []).some(
    (item) => item.ownerBotId === botId && HELD_ITEM_STATES.has(item.state),
  );

  if (holdingAnItem) return false;

  // Any chat the bot might still be answering in keeps it busy: a second turn while the first is
  // in flight would race the provider.
  return readModel.threads
    .filter(
      (thread) => thread.botId === botId && thread.deletedAt === null && thread.archivedAt === null,
    )
    .every(
      (thread) =>
        !LIVE_SESSION_STATUSES.has(thread.session?.status ?? "") &&
        thread.latestTurn?.state !== "running",
    );
}

/** What the next item gets: a member to do it, or the reason there is none. */
export type MemberPick =
  | { readonly kind: "picked"; readonly bot: OrchestrationBot }
  | { readonly kind: "role-holder-busy" }
  | { readonly kind: "none" };

/**
 * The member that takes the next item: an idle specialist the item's role names, or any idle
 * specialist when the item names no role or no member holds that role.
 *
 * An item whose role only a busy member holds stays queued instead of going to someone the item
 * did not ask for (`role-holder-busy`). The boss takes anything only when it is the group's only
 * bot, so a role only the boss carries counts as a role nobody eligible holds. Ties go to the
 * lowest bot id until AC7 picks the one idle longest.
 */
export function pickIdleMember(
  readModel: OrchestrationReadModel,
  group: OrchestrationGroup,
  input: { readonly role?: FleetRoleId; readonly busy?: ReadonlySet<BotId> } = {},
): MemberPick {
  const busy = input.busy ?? new Set<BotId>();
  const members = group.members.filter(isGroupBotMember).map((member) => member.botId);
  const specialists = members.filter((botId) => botId !== group.bossBotId);
  const eligible = specialists.length > 0 ? specialists : members;
  const botOf = (botId: BotId) => readModel.bots.find((bot) => bot.id === botId);

  const free = eligible
    .filter((botId) => !busy.has(botId) && isBotIdle(readModel, botId))
    .toSorted((left, right) => left.localeCompare(right));

  const holders = new Set(
    input.role === undefined ? [] : eligible.filter((botId) => botOf(botId)?.roleId === input.role),
  );

  if (holders.size > 0) {
    const match = free.find((botId) => holders.has(botId));

    if (match === undefined) return { kind: "role-holder-busy" };

    const holder = botOf(match);

    return holder === undefined ? { kind: "role-holder-busy" } : { kind: "picked", bot: holder };
  }

  const next = free[0];
  const bot = next === undefined ? undefined : botOf(next);

  return bot === undefined ? { kind: "none" } : { kind: "picked", bot };
}

export const FleetDispatcherReactorLive = Layer.effect(FleetDispatcherReactor, make);
