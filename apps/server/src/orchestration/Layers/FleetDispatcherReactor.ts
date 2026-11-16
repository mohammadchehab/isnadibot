import {
  BotId,
  CommandId,
  EventId,
  GroupId,
  MessageId,
  PLACEHOLDER_THREAD_TITLE,
  ThreadId,
  WorkItemId,
  isGroupBotMember,
  type IsoDateTime,
  type OrchestrationBot,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationLatestTurn,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type TurnId,
  type WorkItem,
} from "@isnadi/contracts";
import { makeDrainableWorker } from "@isnadi/shared/DrainableWorker";
import {
  deriveBotStatus,
  idleSince,
  isLiveSessionStatus,
  type BotStatusInput,
} from "@isnadi/shared/botStatus";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { forkParked } from "../../serverActivation.ts";
import { OrchestrationCommandInvariantError } from "../Errors.ts";
import {
  FleetDispatcherReactor,
  type FleetDispatcherReactorShape,
} from "../Services/FleetDispatcherReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../Services/RuntimeReceiptBus.ts";
import { botChat, chatModelSelection, chatProjectFor } from "./fleetDispatcherChats.ts";

/** Why a group was left exactly as it was. */
type SkipReason =
  | "queue-empty"
  | "retry-pending"
  | "no-idle-member"
  | "no-chat-project"
  | "chat-create-failed"
  | "claim-lost"
  | "turn-running"
  | "turn-start-failed";

/** The chat a member will work in, or why the dispatcher could not give it one. */
type ChatCreation =
  | { readonly kind: "chat"; readonly thread: OrchestrationThread }
  | { readonly kind: "none"; readonly reason: "no-chat-project" | "chat-create-failed" };

/**
 * One decision a pass reached about a group. A skip always carries its reason, so every skip the
 * dispatcher reports can be read as a diagnosis rather than as silence.
 */
type SkipDecision = {
  readonly kind: "skipped";
  readonly reason: SkipReason;
  readonly itemId?: WorkItemId;
  readonly botId?: BotId;
};

type DispatchDecision =
  | { readonly kind: "assigned"; readonly itemId: WorkItemId; readonly botId: BotId }
  | SkipDecision;

/**
 * How long a requeued item waits before the dispatcher tries it again. A death is usually the
 * provider being briefly unavailable, so the retry is one breath, not a spin.
 */
export const DISPATCH_RETRY_DELAY = Duration.seconds(30);

/**
 * A dispatcher turn that is over while its item is still assigned: the item is stranded and
 * nobody is working it. `cause` decides what happens next — a turn that completed goes back to
 * the queue untouched, an interrupt is a person taking the bot back and requeues at once, and a
 * death requeues once and blocks on the second in a row.
 */
export interface EndedClaim {
  readonly item: WorkItem;
  readonly botId: BotId;
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly cause: "completed" | "interrupted" | "dead";
  readonly detail?: string;
}

/** What one pass carries across every group it decides, so a member is spent once per pass. */
interface SweepState {
  /** Members this pass has already been given an item. */
  readonly busied: Set<BotId>;
  /** Set once the pass published its one skip receipt, so a queue never becomes a receipt storm. */
  skipped: boolean;
}

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

  // The ended turn already reported for an item, so a re-read of the same model cannot reap the
  // same turn twice. Keyed by turn rather than kept forever: the item's next turn is a different
  // id, so it reaps on its own.
  const reapedTurn = new Map<WorkItemId, TurnId>();

  // When a requeued item may be handed out again. A death is usually the provider being briefly
  // unavailable, so the item waits one delay instead of spinning against a broken runtime.
  const retryNotBefore = new Map<WorkItemId, IsoDateTime>();

  // Where the retry sleep is forked: the layer's scope, so it dies with the reactor.
  const scope = yield* Effect.scope;

  // An empty queue is a healthy group between turns, and the wake that finds it is routine, so it
  // is a detail an operator can ask for rather than a warning on every turn end. Every other
  // reason means work is waiting and not moving, which is what the failure paths warn about. Both
  // name the group, the reason, and the member and item when a pass had them in hand.
  const logSkip = (groupId: GroupId, decision: SkipDecision) => {
    const line = "fleet dispatcher skipped a group";

    const fields = {
      groupId,
      reason: decision.reason,
      itemId: decision.itemId,
      botId: decision.botId,
    };

    return decision.reason === "queue-empty"
      ? Effect.logDebug(line, fields)
      : Effect.logWarning(line, fields);
  };

  // Every decision the dispatcher makes flows through here, and the receipt bus is in-process and
  // read by tests only. A skip leaves the queue exactly as it was, so without a log line a running
  // server shows nothing at all while a group waits all day.
  const publishDecision = (groupId: GroupId, decision: DispatchDecision) =>
    DateTime.now.pipe(
      Effect.flatMap((now) => {
        const receipt = {
          type: "fleet.dispatch.decided" as const,
          groupId,
          kind: decision.kind,
          ...(decision.itemId === undefined ? {} : { itemId: decision.itemId }),
          ...(decision.botId === undefined ? {} : { botId: decision.botId }),
          ...(decision.kind === "skipped" ? { reason: decision.reason } : {}),
          createdAt: DateTime.formatIso(now),
        };

        return decision.kind === "skipped"
          ? logSkip(groupId, decision).pipe(Effect.andThen(runtimeReceiptBus.publish(receipt)))
          : runtimeReceiptBus.publish(receipt);
      }),
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

  // Reports that the turn the dispatcher started for an item is over and the item is still
  // assigned. Modelled on `claim`: an invariant refusal means the item already moved on, which is
  // exactly what a reap is trying to achieve, so it reads as "nothing to do" rather than an error.
  //
  // A completed turn never reaches here: it is released, not failed. The command's own cause has
  // no word for it, and that is the point — see `turnEndCause`.
  const failDispatcherTurn = (dead: EndedClaim & { readonly cause: "interrupted" | "dead" }) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            orchestrationEngine.dispatch({
              type: "work-item.dispatcher-failed",
              commandId: CommandId.make(`server:work-item.dispatcher-failed:${uuid}`),
              botId: dead.botId,
              workItemId: dead.item.id,
              threadId: dead.threadId,
              turnId: dead.turnId,
              cause: dead.cause,
              ...(dead.detail === undefined ? {} : { detail: dead.detail }),
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
          : Effect.logWarning("fleet dispatcher could not report a dead turn", {
              botId: dead.botId,
              itemId: dead.item.id,
              turnId: dead.turnId,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(false)),
      ),
    );

  // Puts every stranded item in this group back in play, once per ended turn. A turn that already
  // reported is skipped: the read model can lag behind the events this pass just emitted, and
  // reporting the same end twice would spend the item's one retry on nothing.
  const reapEndedClaims = (readModel: OrchestrationReadModel, group: OrchestrationGroup) =>
    Effect.gen(function* () {
      let reaped = 0;

      for (const ended of endDispatcherClaims(readModel, group.id)) {
        if (reapedTurn.get(ended.item.id) === ended.turnId) continue;

        // Recorded before the dispatch, not after: a refused reap means the item already moved,
        // so retrying the same turn would spin for as long as the model takes to catch up.
        reapedTurn.set(ended.item.id, ended.turnId);

        // A completed turn is not a death. The bot finished the turn it was given, so the item
        // goes back to the queue the way a person unassigning it would: no attempt counted and no
        // line in the chat saying the turn died. Only a turn that failed or vanished is a death.
        if (ended.cause === "completed") {
          yield* releaseClaim(ended.item);
          reaped += 1;

          continue;
        }

        // The completed branch has already returned, so what is left is the two genuine failures —
        // the only two the command carries a word for.
        if (!(yield* failDispatcherTurn({ ...ended, cause: ended.cause }))) continue;

        reaped += 1;

        // Only the first death backs off. A second one blocks the item instead, so there is
        // nothing to retry.
        if (ended.cause === "dead" && (ended.item.attempts ?? 0) === 0) {
          const notBefore = DateTime.addDuration(yield* DateTime.now, DISPATCH_RETRY_DELAY);

          retryNotBefore.set(ended.item.id, DateTime.formatIso(notBefore));

          yield* Effect.forkIn(scope)(
            Effect.sleep(DISPATCH_RETRY_DELAY).pipe(Effect.andThen(schedule(group.id))),
          );
        }
      }

      return reaped;
    });

  // Reports how the start went: it started, or why it did not. A refused start is not an
  // `assigned`: the caller releases the claim and tells the chat why, so no bot is left holding an
  // item nobody runs.
  const startTurn = (thread: OrchestrationThread, item: WorkItem) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) =>
            orchestrationEngine.dispatch({
              type: "thread.turn.start",
              commandId: CommandId.make(`server:dispatcher-turn:${uuid}`),
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
              // AC6: the chat shows this brief as the dispatcher's, not the user's.
              trigger: { kind: "dispatcher", workItemId: item.id },
              createdAt: DateTime.formatIso(now),
            }),
          ),
        ),
      ),
      Effect.as({ started: true as const }),
      // Every refusal — an archived bot, a vanished chat, a decider with nothing to do — is the
      // same fact: no turn started. Its message is what the chat is told.
      Effect.catchIf(
        (error) => isInvariantError(error),
        (error) => Effect.succeed({ started: false as const, detail: error.detail }),
      ),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not start a turn", {
              threadId: thread.id,
              itemId: item.id,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as({ started: false as const, detail: Cause.pretty(cause) })),
      ),
    );

  // A hired member has no chat until someone opens one, so the dispatcher opens it the way the
  // client would: the same placeholder title, the bot's own engine and runtime mode, and no group,
  // so it appears in the sidebar beside every other chat that bot owns.
  //
  // The command's own transaction writes the projection, so the chat is already in the read model
  // when the dispatch resolves — re-reading here is exact, not a race to be waited out.
  const createChatFor = (
    readModel: OrchestrationReadModel,
    bot: OrchestrationBot,
    group: OrchestrationGroup,
  ) =>
    Effect.gen(function* () {
      const project = chatProjectFor(readModel, group);

      if (project === undefined)
        return { kind: "none" as const, reason: "no-chat-project" as const };

      const modelSelection = chatModelSelection(bot, project);

      if (modelSelection === undefined) {
        return { kind: "none" as const, reason: "chat-create-failed" as const };
      }

      const uuid = yield* crypto.randomUUIDv4;
      const createdAt = DateTime.formatIso(yield* DateTime.now);

      const created = yield* orchestrationEngine
        .dispatch({
          type: "thread.create",
          commandId: CommandId.make(`server:thread.create:${uuid}`),
          threadId: ThreadId.make(uuid),
          projectId: project.id,
          botId: bot.id,
          groupId: null,
          title: PLACEHOLDER_THREAD_TITLE,
          modelSelection,
          runtimeMode: bot.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt,
        })
        .pipe(
          Effect.as(true),
          // An archived bot or a vanished project is the decider saying no, which is the same
          // fact as a crash here: the member cannot be given a chat to work in.
          Effect.catchIf(
            (error) => isInvariantError(error),
            (error) =>
              Effect.logWarning("fleet dispatcher could not create a chat", {
                botId: bot.id,
                detail: error.detail,
              }).pipe(Effect.as(false)),
          ),
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause)
              ? Effect.failCause(cause)
              : Effect.logWarning("fleet dispatcher could not create a chat", {
                  botId: bot.id,
                  cause: Cause.pretty(cause),
                }).pipe(Effect.as(false)),
          ),
        );

      if (!created) return { kind: "none" as const, reason: "chat-create-failed" as const };

      const after = yield* projectionSnapshotQuery.getCommandReadModel().pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logWarning("fleet dispatcher could not re-read a created chat", {
                botId: bot.id,
                cause: Cause.pretty(cause),
              }).pipe(Effect.as(undefined)),
        ),
      );

      const chat = after === undefined ? undefined : botChat(after, bot.id);

      // The chat was created but the read model cannot show it yet: the caller gives the item
      // back, and the next pass finds the chat rather than making a second one.
      return chat === undefined
        ? { kind: "none" as const, reason: "chat-create-failed" as const }
        : { kind: "chat" as const, thread: chat };
    });

  // The claim is the only thing holding the item, so releasing it is the way back: the existing
  // null-owner branch of `work-item.assign` returns the item to its group's queue, unowned. It is
  // also the way a completed dispatcher turn ends — the release says nothing about a failure, so
  // nothing is counted and the chat is told nothing.
  const releaseClaim = (item: WorkItem) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        orchestrationEngine.dispatch({
          type: "work-item.assign",
          commandId: CommandId.make(`server:work-item.assign:${uuid}`),
          workItemId: item.id,
          ownerBotId: null,
        }),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not release a claim", {
              itemId: item.id,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // The chat's work log says why the item came back, in the tone the other reactors use for their
  // own failures. The id is deterministic, so a retried pass cannot post the row twice.
  const reportStartFailed = (
    thread: OrchestrationThread,
    item: WorkItem,
    botId: BotId,
    detail: string,
  ) =>
    crypto.randomUUIDv4.pipe(
      Effect.flatMap((uuid) =>
        DateTime.now.pipe(
          Effect.flatMap((now) => {
            const createdAt = DateTime.formatIso(now);

            return orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId: CommandId.make(`server:work-item.start-failed:${uuid}`),
              threadId: thread.id,
              activity: {
                id: EventId.make(`work-item-start-failed:${item.id}`),
                tone: "error",
                kind: "work-item.start-failed",
                summary: `"${item.title}" could not start, so it is back in the queue.`,
                payload: { itemId: item.id, botId, detail },
                turnId: null,
                createdAt,
              },
              createdAt,
            });
          }),
        ),
      ),
      Effect.asVoid,
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not report a failed start", {
              threadId: thread.id,
              itemId: item.id,
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // Hands out as many waiting items as the group has idle members. A claim changes neither the
  // read model in hand nor the read model's view of who is free, so both are kept current here.
  const dispatchGroup = (
    readModel: OrchestrationReadModel,
    group: OrchestrationGroup,
    sweepState: SweepState,
  ) =>
    Effect.gen(function* () {
      // Reaping comes first: an item whose turn ended is still `assigned` in this snapshot, so it
      // cannot be handed out until the release it causes is projected. The wake that follows
      // re-reads the model, so this pass never dispatches from a snapshot it just invalidated.
      if ((yield* reapEndedClaims(readModel, group)) > 0) yield* schedule(group.id);

      const now = DateTime.formatIso(yield* DateTime.now);
      const queued = queuedWorkItems(readModel, group.id);

      // A requeued item sits out its retry delay. ISO timestamps of one format sort as strings,
      // which is the whole comparison this needs.
      const waiting = queued.filter((item) => {
        const notBefore = retryNotBefore.get(item.id);

        if (notBefore === undefined) return true;

        // The retry wakes at exactly `notBefore`, so the boundary is due, not held.
        if (now < notBefore) return false;

        retryNotBefore.delete(item.id);

        return true;
      });

      if (waiting.length === 0) {
        yield* publishDecision(group.id, {
          kind: "skipped",
          reason: queued.length === 0 ? "queue-empty" : "retry-pending",
        });

        return false;
      }

      // One skip per pass, and only while the pass has handed nothing out: a lost claim or a group
      // with nobody free is a note about the pass, not about every item waiting in it.
      const skip = (fields: {
        readonly itemId: WorkItemId;
        readonly botId?: BotId;
        readonly reason: SkipReason;
      }) => {
        if (sweepState.busied.size > 0 || sweepState.skipped) return Effect.void;

        sweepState.skipped = true;

        return publishDecision(group.id, { kind: "skipped", ...fields });
      };

      let lostClaim = false;

      for (const item of waiting) {
        // The item is back in the queue but the turn that was working it has not finished.
        // Handing it out now would put a second bot on it; the turn-end wake clears this.
        if (runningDispatcherTurnItem(readModel, item.id) !== undefined) {
          yield* skip({ itemId: item.id, reason: "turn-running" });

          continue;
        }

        const pick = pickIdleMember(readModel, group, sweepState.busied);

        if (pick.kind === "none") {
          yield* skip({ itemId: item.id, reason: pick.reason });

          break;
        }

        const existingChat = botChat(readModel, pick.bot.id);

        // A hired member has no chat, and where a new one belongs is a pure read of the model.
        // With several projects and no chat to read, nothing in this group can be filed, so its
        // queue waits. That is a precondition like having no free member rather than a failure,
        // so it is answered before a claim is spent on it.
        if (existingChat === undefined && chatProjectFor(readModel, group) === undefined) {
          yield* skip({ itemId: item.id, botId: pick.bot.id, reason: "no-chat-project" });

          break;
        }

        // The claim comes before any chat is created: a claim this pass loses must not leave
        // behind a chat nobody asked for.
        if (!(yield* claim(pick.bot.id, item.id))) {
          yield* skip({ itemId: item.id, botId: pick.bot.id, reason: "claim-lost" });
          lostClaim = true;

          // The claim took another item; it says nothing about the rest of the queue.
          continue;
        }

        // The chat the member would have opened for itself, so keep-busy works on a team nobody
        // has visited yet.
        const chat: ChatCreation =
          existingChat === undefined
            ? yield* createChatFor(readModel, pick.bot, group)
            : { kind: "chat", thread: existingChat };

        if (chat.kind === "none") {
          // The chat could not be created, so the item goes back rather than staying claimed by a
          // bot that is not working it. The reason is the group's, so the queue waits with it.
          yield* releaseClaim(item);
          yield* skip({ itemId: item.id, botId: pick.bot.id, reason: chat.reason });

          break;
        }

        const start = yield* startTurn(chat.thread, item);

        if (!start.started) {
          // Nothing is running, so nothing is assigned: give the item back and say why in the
          // chat, rather than publishing an `assigned` no bot is doing.
          yield* releaseClaim(item);
          yield* reportStartFailed(chat.thread, item, pick.bot.id, start.detail);
          yield* skip({ itemId: item.id, botId: pick.bot.id, reason: "turn-start-failed" });

          // The item is back in the queue and this member was not spent, so the rest of the
          // queue still gets its turn.
          continue;
        }

        yield* publishDecision(group.id, {
          kind: "assigned",
          itemId: item.id,
          botId: pick.bot.id,
        });
        sweepState.busied.add(pick.bot.id);
      }

      // The caller re-reads the model once when this is true: a refused claim means the snapshot
      // in hand is stale, and the items behind the lost one deserve the fresh one.
      return lostClaim;
    });

  // A refused claim means the pass decided from a snapshot the engine had already left behind. One
  // fresh read and one more decision is enough to drain what waited behind the lost item, and it is
  // bounded: re-waking the worker instead would spin for as long as the projection takes to catch
  // up, and a claim that keeps being refused would never let it settle.
  const reReadAndDispatch = (groupId: GroupId, sweepState: SweepState) =>
    projectionSnapshotQuery.getCommandReadModel().pipe(
      Effect.flatMap((readModel) => {
        const group = readModel.groups.find((candidate) => candidate.id === groupId);

        return group === undefined || group.keepBusy !== true
          ? Effect.void
          : dispatchGroup(readModel, group, sweepState).pipe(Effect.asVoid);
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not re-read a group", {
              cause: Cause.pretty(cause),
            }),
      ),
    );

  const sweep = (groupIds: ReadonlyArray<GroupId>) =>
    projectionSnapshotQuery.getCommandReadModel().pipe(
      Effect.flatMap((readModel) => {
        // One pass decides every group from one snapshot, so it also spends each member once.
        const sweepState: SweepState = { busied: new Set(), skipped: false };

        return Effect.forEach(
          groupIds,
          (groupId) => {
            const group = readModel.groups.find((candidate) => candidate.id === groupId);

            if (group === undefined || group.keepBusy !== true) return Effect.void;

            return dispatchGroup(readModel, group, sweepState).pipe(
              Effect.flatMap((lostClaim) =>
                lostClaim ? reReadAndDispatch(groupId, sweepState) : Effect.void,
              ),
            );
          },
          { discard: true },
        );
      }),
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

  // Typed explicitly: the reap and the retry it forks both call back into the sweep, and without a
  // written return type that loop makes every function on it infer `any`.
  const schedule = (groupId: GroupId): Effect.Effect<void> =>
    Ref.update(pending, (groups) =>
      groups.has(groupId) ? groups : new Set([...groups, groupId]),
    ).pipe(Effect.andThen(worker.enqueue(undefined)));

  // A bot's group, for the events that name a bot rather than a group or a thread.
  const groupOfBot = (readModel: OrchestrationReadModel, botId: BotId): GroupId | undefined =>
    readModel.bots.find((bot) => bot.id === botId)?.groupId ?? undefined;

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

    return groupOfBot(readModel, botId);
  };

  // The event names a thread, but only the read model says which groups are worth a look — and the
  // decision that follows reads the read model anyway.
  const scheduleGroupsAfterRead = (
    resolve: (readModel: OrchestrationReadModel) => Iterable<GroupId | undefined>,
  ) =>
    projectionSnapshotQuery.getCommandReadModel().pipe(
      Effect.flatMap((readModel) => {
        const groups = new Set<GroupId>();

        for (const groupId of resolve(readModel)) {
          if (groupId !== undefined) groups.add(groupId);
        }

        return Effect.forEach(groups, (groupId) => schedule(groupId), { discard: true });
      }),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("fleet dispatcher could not resolve a group", {
              cause: Cause.pretty(cause),
            }),
      ),
    );

  // The event names a thread or a group, but only the read model says which group that is — and
  // the decision that follows reads the read model anyway.
  const scheduleAfterRead = (groupId: GroupId | undefined, threadId?: ThreadId) =>
    groupId !== undefined
      ? schedule(groupId)
      : scheduleGroupsAfterRead((readModel) => [
          threadId === undefined ? undefined : groupOfThread(readModel, threadId),
        ]);

  // The turn that just ended may have been working an item that a group move has since put in
  // another group. The release-time sweep skipped it while this turn was live, so the wake that
  // clears the guard has to reach the item's current group or the item never gets picked up.
  const turnEnded = (threadId: ThreadId, turnId: TurnId | string) => {
    if (handledTurnEnd.get(threadId) === turnId) return Effect.void;

    handledTurnEnd.set(threadId, turnId);

    return scheduleGroupsAfterRead((readModel) => [
      groupOfThread(readModel, threadId),
      dispatcherTurnItemGroup(readModel, threadId),
    ]);
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

        return isLiveSessionStatus(session.status)
          ? Effect.void
          : turnEnded(threadId, lastTurnId.get(threadId) ?? `event:${event.sequence}`);
      }

      // A new chat is what a chatless member was missing: the queued item can run now. Losing a
      // chat only removes dispatchability, so thread.deleted and thread.archived wake nobody.
      case "thread.created":
        return scheduleAfterRead(event.payload.groupId ?? undefined, event.payload.threadId);

      // A roster change decides who the pick can choose from, so an item that had no free member
      // may have one now: a join adds a candidate, a departure frees the pick, and a boss change
      // moves the specialist/boss split. None of them touches an item, so nothing else wakes it.
      case "group.member-assigned":
      case "group.member-unassigned":
      case "group.boss-set":
        return schedule(event.payload.groupId);

      // Restoring a bot makes it idle and dispatchable again. Archiving only removes
      // dispatchability, so bot.archived wakes nobody, the way thread.deleted does not.
      case "bot.restored":
        return scheduleGroupsAfterRead((readModel) => [groupOfBot(readModel, event.payload.botId)]);

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

/**
 * The item a live dispatcher turn is still working, if the read model can still see that turn.
 *
 * A group move or a human unassign releases an in-progress item back to queued and unowned, which
 * is what stops it stranding — but the turn that was working it keeps running against it. Handing
 * the item out again would put two bots on one item, so the dispatcher leaves it alone until that
 * turn reports terminal.
 *
 * Keyed on the turn's trigger, not on the item's chat: `work-item.claim` never sets `threadId`, so
 * an item the dispatcher has just claimed usually has no chat to key on.
 *
 * Fails open. A turn the read model cannot see — settled, interrupted, or a thread that was
 * deleted — releases the item, which is the safe direction: an item nobody is working must not sit
 * in the queue forever.
 */
export function runningDispatcherTurnItem(
  readModel: OrchestrationReadModel,
  itemId: WorkItemId,
): ThreadId | undefined {
  const thread = readModel.threads.find((candidate) => {
    const turn = candidate.latestTurn;
    const trigger = turn?.trigger;

    return (
      candidate.deletedAt === null &&
      turn?.state === "running" &&
      trigger?.kind === "dispatcher" &&
      trigger.workItemId === itemId
    );
  });

  return thread?.id;
}

/**
 * How a turn that is not live stopped working its item, or `undefined` when it has not stopped.
 *
 * A turn that completed is not a death. The bot finished the turn it was given and the item goes
 * back to the queue untouched: nothing judged the turn for progress, so counting an attempt
 * against it and recording a death would report a failure that never happened, and two in a row
 * would block the card. The end is read from the turn's own state, never from how long the reap
 * took — the gap between a turn completing and its item being released is not a fixed window.
 * That is why `completed` is its own answer here rather than the `dead` it used to share with
 * `error`.
 *
 * A person stopping the bot is not the bot failing, so it reads as `interrupted`; a turn that
 * reported an error is `dead`. The turn's own state settles those. A turn still reading as
 * running is only dead when its session has left the live statuses with no turn of its own active
 * — the process went away without the turn ever reporting. A session that is missing or `null` is
 * a turn that has not opened one yet, not a death.
 */
function turnEndCause(
  thread: OrchestrationThread,
  turn: OrchestrationLatestTurn,
): EndedClaim["cause"] | undefined {
  if (turn.state === "completed") return "completed";

  if (turn.state === "interrupted") return "interrupted";

  if (turn.state === "error") return "dead";

  const session = thread.session;

  if (session === null || session === undefined) return undefined;

  if (isLiveSessionStatus(session.status) || session.activeTurnId !== null) return undefined;

  return "dead";
}

/**
 * Every dispatcher turn in the group that is over while its item is still assigned.
 *
 * The turn is found by its trigger, not by the item's chat: `work-item.claim` never sets
 * `threadId`, so an item the dispatcher claimed usually has no chat to key on. A chat whose latest
 * turn is not this item's dispatcher turn has moved on, which means the bot is alive and there is
 * nothing to reap — so a newer turn in that chat is the guard, not an oversight.
 */
export function endDispatcherClaims(
  readModel: OrchestrationReadModel,
  groupId: GroupId,
): ReadonlyArray<EndedClaim> {
  const claims: EndedClaim[] = [];

  for (const item of readModel.workItems ?? []) {
    if (item.groupId !== groupId || item.state !== "assigned" || item.ownerBotId === undefined)
      continue;

    const thread = readModel.threads.find((candidate) => {
      const trigger = candidate.latestTurn?.trigger;

      return (
        candidate.deletedAt === null &&
        trigger?.kind === "dispatcher" &&
        trigger.workItemId === item.id
      );
    });

    const turn = thread?.latestTurn;

    if (thread === undefined || turn === undefined || turn === null) continue;

    const cause = turnEndCause(thread, turn);

    if (cause === undefined) continue;

    const detail = turn.errorMessage ?? turn.unavailability;

    claims.push({
      item,
      botId: item.ownerBotId,
      threadId: thread.id,
      turnId: turn.turnId,
      cause,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  return claims;
}

/**
 * The group that currently owns the item a thread's dispatcher turn is working, if that turn is
 * the thread's latest and it was a dispatcher turn. A moved item belongs to its new group, which is
 * not the group of the thread the turn ran in.
 */
export function dispatcherTurnItemGroup(
  readModel: OrchestrationReadModel,
  threadId: ThreadId,
): GroupId | undefined {
  const trigger = readModel.threads.find((candidate) => candidate.id === threadId)?.latestTurn
    ?.trigger;

  if (trigger?.kind !== "dispatcher") return undefined;

  return (readModel.workItems ?? []).find((item) => item.id === trigger.workItemId)?.groupId;
}

/**
 * The shared status rule's input for one bot, built from the command read model. The dispatcher
 * reacts fast enough that a stale read is unlikely and harmless: the claim is what decides who
 * owns an item.
 */
function statusInput(readModel: OrchestrationReadModel, botId: BotId): BotStatusInput {
  return {
    botId,
    chats: readModel.threads.filter((thread) => thread.deletedAt === null),
    workItems: readModel.workItems ?? [],
    delegations: readModel.delegations ?? [],
  };
}

/**
 * Whether the dispatcher may hand this bot the next queued item: it exists, it is not archived, and
 * the shared status rule (`@isnadi/shared/botStatus`) reads it as idle. Asking, held and busy all
 * mean the bot is not free, so only `idle` is dispatchable.
 */
export function isBotIdle(readModel: OrchestrationReadModel, botId: BotId): boolean {
  const bot = readModel.bots.find((candidate) => candidate.id === botId);

  if (bot === undefined || bot.archivedAt !== null) return false;

  return deriveBotStatus(statusInput(readModel, botId)) === "idle";
}

/**
 * A free member ranked by who has been free longest. A bot with no turn at all has no idle time,
 * which ranks it above every bot with one; the total order means the same read model always picks
 * the same bot. Nothing here calls a model: the pick is the receipt's `botId`.
 */
interface IdleRank {
  readonly idleSince: IsoDateTime | null;
  readonly botId: BotId;
}

const idleRank = (readModel: OrchestrationReadModel, botId: BotId): IdleRank => ({
  idleSince: idleSince(statusInput(readModel, botId)),
  botId,
});

function compareIdleRank(left: IdleRank, right: IdleRank): number {
  if (left.idleSince !== right.idleSince) {
    if (left.idleSince === null) return -1;

    if (right.idleSince === null) return 1;

    return left.idleSince.localeCompare(right.idleSince);
  }

  return left.botId.localeCompare(right.botId);
}

/**
 * The member that takes the next item: the idle specialist who has been free longest, or the boss
 * when it is the only bot in the group. Two idle members are never both woken for one item, and no
 * model is asked to choose between them.
 *
 * Being idle is the whole test. Whether the member already has a chat is the caller's problem: a
 * hired member starts without one and is given the chat it would have opened for itself, so
 * leaving it out here would leave a fresh team unable to work at all.
 */
export type PickResult =
  | { readonly kind: "member"; readonly bot: OrchestrationBot }
  | { readonly kind: "none"; readonly reason: "no-idle-member" };

export function pickIdleMember(
  readModel: OrchestrationReadModel,
  group: OrchestrationGroup,
  busy: ReadonlySet<BotId> = new Set(),
): PickResult {
  const members = group.members.filter(isGroupBotMember).map((member) => member.botId);
  const specialists = members.filter((botId) => botId !== group.bossBotId);
  const candidates = specialists.length > 0 ? specialists : members;

  const free = candidates
    .filter((candidate) => !busy.has(candidate) && isBotIdle(readModel, candidate))
    .flatMap((candidate) => {
      const bot = readModel.bots.find((candidateBot) => candidateBot.id === candidate);

      return bot === undefined ? [] : [{ bot, rank: idleRank(readModel, candidate) }];
    })
    .toSorted((left, right) => compareIdleRank(left.rank, right.rank));

  const picked = free[0];

  return picked === undefined
    ? { kind: "none", reason: "no-idle-member" }
    : { kind: "member", bot: picked.bot };
}

export const FleetDispatcherReactorLive = Layer.effect(FleetDispatcherReactor, make);
