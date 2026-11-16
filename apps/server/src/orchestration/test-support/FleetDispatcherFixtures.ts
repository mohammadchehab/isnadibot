import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type BotId,
  CheckpointRef,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  EventId,
  GroupId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  WorkItemId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationLatestTurnState,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type WorkItem,
} from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ServerActivation } from "../../serverActivation.ts";
import { type OrchestrationDispatchError } from "../Errors.ts";
import { FleetDispatcherReactor } from "../Services/FleetDispatcherReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type OrchestrationRuntimeReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { FleetDispatcherReactorLive } from "../Layers/FleetDispatcherReactor.ts";
import {
  GROUP_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "./GroupDeciderFixtures.ts";

export const NOW = "2026-01-01T00:00:00.000Z";

export const LATER = "2026-01-01T00:00:05.000Z";

export const LATEST = "2026-01-01T00:00:10.000Z";

export const BOT_THREAD = ThreadId.make("thread-bot-specialist");

/** Two specialists whose ids sort in the order the pick uses, spelled out to keep it obvious. */
export const BOT_A = makeBot({ id: "bot-a" as BotId, groupId: GROUP_ID });

export const BOT_B = makeBot({ id: "bot-b" as BotId, groupId: GROUP_ID });

/**
 * The dispatcher's own read model carries full threads that lack the pending flags: they are
 * computed only into the shell snapshot. The idle rule reads those fields, so the fixtures on its
 * path spell them out instead of pretending the command read model already has them.
 */
export type Ac3Thread = OrchestrationThread &
  Pick<OrchestrationThreadShell, "hasPendingApprovals" | "hasPendingUserInput">;

export const botThread = (botId: BotId, id: string): OrchestrationThread => ({
  ...makeGroupThread(),
  id: ThreadId.make(id),
  botId,
  groupId: null,
  session: null,
  latestTurn: null,
});

export const workItem = (input: {
  readonly id: string;
  readonly state?: WorkItem["state"];
  readonly ownerBotId?: BotId;
  readonly groupId?: GroupId;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly attempts?: number;
  readonly role?: WorkItem["role"];
}): WorkItem => ({
  id: WorkItemId.make(input.id),
  groupId: input.groupId ?? GROUP_ID,
  title: `Item ${input.id}`,
  brief: "Fix the thing.",
  kind: "task",
  state: input.state ?? "queued",
  ...(input.ownerBotId === undefined ? {} : { ownerBotId: input.ownerBotId }),
  ...(input.attempts === undefined ? {} : { attempts: input.attempts }),
  ...(input.role === undefined ? {} : { role: input.role }),
  createdAt: input.createdAt ?? NOW,
  updatedAt: input.updatedAt ?? NOW,
});

/** A bot that has left `GROUP_ID` for another one, and the chat its dispatcher turn ran in. */
export const MOVED_GROUP = GroupId.make("group-moved");

export const MOVED_BOT = makeBot({ id: "bot-moved" as BotId, groupId: MOVED_GROUP });

export const MOVED_THREAD = ThreadId.make("thread-bot-moved");

/** A chat whose latest turn is a dispatcher turn for `workItemId`, in the given state. */
const dispatcherTurnThread = (
  threadId: ThreadId,
  workItemId: string,
  botId: BotId,
  state: OrchestrationLatestTurnState,
  extra: { readonly errorMessage?: string; readonly unavailability?: string } = {},
): OrchestrationThread => ({
  ...botThread(botId, threadId),
  latestTurn: {
    turnId: TurnId.make(`turn-${workItemId}`),
    state,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: state === "running" ? null : LATER,
    assistantMessageId: null,
    trigger: { kind: "dispatcher", workItemId: WorkItemId.make(workItemId) },
    ...extra,
  },
});

/**
 * A chat whose latest turn is a dispatcher turn for `workItemId` and is still running: the state a
 * released work item has to survive before the dispatcher may hand it out again.
 */
export const runningDispatcherTurn = (threadId: ThreadId, workItemId: string, botId: BotId) =>
  dispatcherTurnThread(threadId, workItemId, botId, "running");

/** The same chat once that turn reports terminal, which is what releases the item. */
export const settledDispatcherTurn = (threadId: ThreadId, workItemId: string, botId: BotId) =>
  dispatcherTurnThread(threadId, workItemId, botId, "completed");

/**
 * A chat whose latest turn is the user's own, requested after the item was handed to the bot.
 *
 * This is what a second `thread.turn.start` in a chat leaves behind (TASK-407): the thread holds
 * one pending turn start, the user's start overwrites the dispatcher's before any turn row exists,
 * and the turn that actually runs carries no dispatcher trigger. The claim is still the bot's, so
 * the only thing left to prove it is the ordering — this turn began after the item was assigned.
 */
export const userTurnAfterClaim = (
  threadId: ThreadId,
  botId: BotId,
  state: OrchestrationLatestTurnState,
  requestedAt: string = LATER,
): OrchestrationThread => ({
  ...botThread(botId, threadId),
  latestTurn: {
    turnId: TurnId.make("turn-user"),
    state,
    requestedAt,
    startedAt: requestedAt,
    completedAt: state === "running" ? null : LATEST,
    assistantMessageId: null,
    trigger: { kind: "user", messageId: MessageId.make("message-user") },
  },
});

/** The same chat after that turn failed: the bot never got anywhere with the item. */
export const failedDispatcherTurn = (
  threadId: ThreadId,
  workItemId: string,
  botId: BotId,
  errorMessage = "provider exited",
) => dispatcherTurnThread(threadId, workItemId, botId, "error", { errorMessage });

/** The same chat after a person stopped the turn: the bot did not fail, it was taken back. */
export const interruptedDispatcherTurn = (threadId: ThreadId, workItemId: string, botId: BotId) =>
  dispatcherTurnThread(threadId, workItemId, botId, "interrupted");

/**
 * The same chat while the turn is genuinely alive: the session is running and holds the turn, so
 * nothing about it is a death and the dispatcher has to leave the item alone.
 */
export const liveDispatcherTurn = (threadId: ThreadId, workItemId: string, botId: BotId) => ({
  ...dispatcherTurnThread(threadId, workItemId, botId, "running"),
  session: {
    threadId,
    status: "running" as const,
    providerName: "codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: TurnId.make(`turn-${workItemId}`),
    lastError: null,
    updatedAt: LATER,
  },
});

/**
 * The same chat when the provider process went away without the turn ever reporting: the turn
 * still reads as running, but its session has left the live statuses with nothing active.
 */
export const crashedDispatcherTurn = (threadId: ThreadId, workItemId: string, botId: BotId) => ({
  ...dispatcherTurnThread(threadId, workItemId, botId, "running"),
  session: {
    threadId,
    status: "error" as const,
    providerName: "codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    activeTurnId: null,
    lastError: "provider exited",
    updatedAt: LATER,
  },
});

export const keepBusyGroup = (
  input: {
    readonly bossBotId?: OrchestrationGroup["bossBotId"];
    readonly members?: OrchestrationGroup["members"];
  } = {},
): OrchestrationGroup => ({ ...makeGroup(input), keepBusy: true });

/** The project every fixture chat already belongs to, so a created chat has one to join. */
export const PROJECT_ID = ProjectId.make("project-1");

/** A project a chat created by the dispatcher can be filed under. */
export const makeProject = (
  input: { readonly id?: ProjectId; readonly deletedAt?: string | null } = {},
): OrchestrationProject => ({
  id: input.id ?? PROJECT_ID,
  title: "Project",
  workspaceRoot: "/tmp/project",
  defaultModelSelection: { instanceId: ProviderInstanceId.make("default"), model: "default-model" },
  scripts: [],
  createdAt: NOW,
  updatedAt: NOW,
  deletedAt: input.deletedAt ?? null,
});

/** One idle specialist in a keep-busy group, with its own chat and nothing queued. */
export const idleTeamModel = (items: ReadonlyArray<WorkItem> = []): OrchestrationReadModel => ({
  ...makeReadModel({
    projects: [makeProject()],
    bots: [makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID })],
    groups: [keepBusyGroup()],
    threads: [botThread(SPECIALIST_ID, "thread-bot-specialist")],
  }),
  workItems: items,
});

export const base = (sequence: number, eventType: string) => ({
  sequence,
  eventId: EventId.make(`event-${sequence}`),
  occurredAt: NOW,
  commandId: null,
  causationEventId: null,
  correlationId: null,
  metadata: {},
  aggregateKind: eventType.startsWith("group.") ? ("group" as const) : ("thread" as const),
  aggregateId: eventType.startsWith("group.") ? GROUP_ID : BOT_THREAD,
});

export const sessionSet = (
  sequence: number,
  threadId: ThreadId,
  status: "running" | "ready" | "error",
  activeTurnId: TurnId | null = null,
) =>
  ({
    ...base(sequence, "thread.session-set"),
    aggregateId: threadId,
    type: "thread.session-set",
    payload: {
      threadId,
      session: {
        threadId,
        status,
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId,
        lastError: null,
        updatedAt: NOW,
      },
    },
  }) satisfies OrchestrationEvent;

/** The turn-end the dispatcher also has to honour: a diff finishing, with the session still up. */
export const turnDiffCompleted = (sequence: number, threadId: ThreadId, turnId: string) =>
  ({
    ...base(sequence, "thread.turn-diff-completed"),
    aggregateId: threadId,
    type: "thread.turn-diff-completed",
    payload: {
      threadId,
      turnId: TurnId.make(turnId),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/isnadi/checkpoints/turn-1"),
      status: "ready",
      files: [],
      assistantMessageId: null,
      completedAt: NOW,
    },
  }) satisfies OrchestrationEvent;

export const keepBusySet = (sequence: number, keepBusy: boolean) =>
  ({
    ...base(sequence, "group.keep-busy-set"),
    type: "group.keep-busy-set",
    payload: { groupId: GROUP_ID, keepBusy, updatedAt: NOW },
  }) satisfies OrchestrationEvent;

/**
 * The roster events that decide who the pick may choose from. None of them touches an item, so
 * each one is the only thing that can wake a group whose queue was left waiting.
 */
export const memberAssigned = (sequence: number, botId: BotId) =>
  ({
    ...base(sequence, "group.member-assigned"),
    type: "group.member-assigned",
    payload: {
      groupId: GROUP_ID,
      member: { kind: "bot" as const, botId, role: "specialist" as const },
      updatedAt: NOW,
    },
  }) satisfies OrchestrationEvent;

export const memberUnassigned = (sequence: number, botId: BotId) =>
  ({
    ...base(sequence, "group.member-unassigned"),
    type: "group.member-unassigned",
    payload: { groupId: GROUP_ID, botId, updatedAt: NOW },
  }) satisfies OrchestrationEvent;

export const bossSet = (sequence: number, bossBotId: BotId, previousBossBotId: BotId | null) =>
  ({
    ...base(sequence, "group.boss-set"),
    type: "group.boss-set",
    payload: {
      groupId: GROUP_ID,
      bossBotId,
      previousBossBotId,
      previousBossRole: previousBossBotId === null ? null : ("specialist" as const),
      updatedAt: NOW,
    },
  }) satisfies OrchestrationEvent;

/** A restore names only the bot, so the group has to come from the read model. */
export const botRestored = (sequence: number, botId: BotId) =>
  ({
    ...base(sequence, "bot.restored"),
    aggregateKind: "bot" as const,
    aggregateId: botId,
    type: "bot.restored",
    payload: { botId, updatedAt: NOW },
  }) satisfies OrchestrationEvent;

export const workItemCreated = (sequence: number, item: WorkItem) =>
  ({
    ...base(sequence, "work-item.created"),
    aggregateKind: "group" as const,
    aggregateId: GROUP_ID,
    type: "work-item.created",
    payload: { workItem: item },
  }) satisfies OrchestrationEvent;

/**
 * A chat appearing. A bot's own chat has no groupId; a chat in the space has the group and no bot.
 */
export const threadCreated = (
  sequence: number,
  input: { readonly threadId: ThreadId; readonly botId: BotId | null; readonly groupId?: GroupId },
) =>
  ({
    ...base(sequence, "thread.created"),
    aggregateId: input.threadId,
    type: "thread.created",
    payload: {
      threadId: input.threadId,
      projectId: ProjectId.make("project-1"),
      botId: input.botId,
      groupId: input.groupId ?? null,
      parentThreadId: null,
      parentDelegationId: null,
      title: "New chat",
      modelSelection: { instanceId: ProviderInstanceId.make("default"), model: "default-model" },
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      branch: null,
      worktreePath: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  }) satisfies OrchestrationEvent;

/**
 * A dispatch the engine refuses: a lost claim, because another group already took the item, or a
 * turn that could not start. `workItemId` narrows it to one item, and `remaining` spends the
 * refusal so a later pass succeeds — that is how a pass that re-reads the read model is tested.
 */
export interface Rejection {
  readonly type: string;
  readonly error: OrchestrationDispatchError;
  readonly workItemId?: WorkItemId;
  readonly remaining?: number;
}

const rejects = (rule: Rejection, command: OrchestrationCommand) =>
  rule.type === command.type &&
  (rule.workItemId === undefined ||
    ("workItemId" in command && command.workItemId === rule.workItemId));

/**
 * Runs after every dispatch decision, standing in for the projector that follows the command. A
 * test uses it to move the read model forward the way the real events would; without it a pass
 * that re-reads the model sees the same queue twice.
 */
export type OnCommand = (
  command: OrchestrationCommand,
  outcome: "accepted" | "rejected",
) => Effect.Effect<void>;

/**
 * The release a group move or a human unassign emits: the item is queued and unowned again. Both
 * arrive here as the same event, so the dispatcher cannot tell them apart — and does not need to.
 */
export const workItemAssigned = (sequence: number, item: WorkItem) =>
  ({
    ...base(sequence, "work-item.assigned"),
    aggregateKind: "group" as const,
    aggregateId: GROUP_ID,
    type: "work-item.assigned",
    payload: { workItem: item },
  }) satisfies OrchestrationEvent;

/**
 * The projector's effect for a created chat. The fake engine records the command but projects
 * nothing, and the dispatcher re-reads the read model to find the chat it just made — so without
 * this the create reads back as a failure. The thread the command names appears in the model.
 */
export const projectCreatedChats =
  (h: Effect.Success<typeof harness>): OnCommand =>
  (command, outcome) =>
    Effect.gen(function* () {
      if (command.type !== "thread.create" || outcome !== "accepted") return;

      const botId = command.botId;

      if (botId === null || botId === undefined) return;

      yield* Ref.update(h.model, (model) => ({
        ...model,
        threads: [...model.threads, botThread(botId, command.threadId)],
      }));
    });

/**
 * The dispatcher's own decisions, narrowed out of the union of receipts a reactor publishes.
 * `kind` only exists on this member, so a test reads it through here rather than off the union.
 */
export const fleetDecisions = (receipts: ReadonlyArray<OrchestrationRuntimeReceipt>) =>
  receipts.filter((receipt) => receipt.type === "fleet.dispatch.decided");

export const harness = Effect.gen(function* () {
  const dispatched: OrchestrationCommand[] = [];

  // When set, a matching dispatch fails, as the engine does for a lost claim or a refused turn
  // start. Any dispatch error works, so a test can tell a refusal from a crash.
  const rejection = yield* Ref.make<Rejection | undefined>(undefined);

  // When set, runs after each decision so a test can project the command into the read model.
  const onCommand = yield* Ref.make<OnCommand | undefined>(undefined);

  const events = yield* PubSub.unbounded<OrchestrationEvent>();

  // The dispatcher publishes its decision inline in the fiber that made it, so a plain Ref is
  // enough: by the time the reactor reports the queue drained, every receipt is in here.
  const receipts = yield* Ref.make<ReadonlyArray<OrchestrationRuntimeReceipt>>([]);

  const receiptBus = Layer.succeed(RuntimeReceiptBus, {
    publish: (receipt) => Ref.update(receipts, (all) => [...all, receipt]),
    streamEventsForTest: Stream.empty,
  });

  const engine: OrchestrationEngineService["Service"] = {
    readEvents: () => Stream.die("unused"),
    readThreadEvents: () => Stream.die("unused"),
    getThreadReplayStats: () => Effect.die("unused"),
    dispatch: (command) =>
      Effect.all([Ref.get(rejection), Ref.get(onCommand)]).pipe(
        Effect.flatMap(([rule, hook]) =>
          Effect.gen(function* () {
            const refused = rule !== undefined && rejects(rule, command);

            if (!refused) dispatched.push(command);

            // A refusal with `remaining` is spent once, so a later pass can win the claim.
            if (refused && rule.remaining !== undefined)
              yield* Ref.update(rejection, (current) =>
                current?.remaining === undefined || current.remaining <= 1
                  ? undefined
                  : { ...current, remaining: current.remaining - 1 },
              );

            if (hook !== undefined)
              yield* hook(command, refused ? "rejected" : "accepted").pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.void,
                ),
              );

            if (refused) return yield* rule.error;

            return { sequence: dispatched.length };
          }),
        ),
      ),
    get streamDomainEvents() {
      return Stream.die("start should subscribe") as Stream.Stream<OrchestrationEvent>;
    },
    subscribeDomainEvents: PubSub.subscribe(events).pipe(Effect.map(Stream.fromSubscription)),
    latestSequence: Effect.succeed(0),
  };

  const activation = yield* Deferred.make<void>();
  yield* Deferred.succeed(activation, undefined);

  // The model the dispatcher reads. A test moves it forward between events, the way projecting
  // those events would.
  const model = yield* Ref.make<OrchestrationReadModel>(idleTeamModel());

  return {
    dispatched,
    rejection,
    onCommand,
    events,
    engine,
    activation,
    model,
    receipts,
    receiptBus,
  };
});

export const run = <A, E>(
  h: Effect.Success<typeof harness>,
  body: (context: {
    readonly reactor: FleetDispatcherReactor["Service"];
    readonly receipts: Effect.Effect<ReadonlyArray<OrchestrationRuntimeReceipt>>;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const reactor = yield* FleetDispatcherReactor;

    yield* reactor.start();

    return yield* body({ reactor, receipts: Ref.getAndSet(h.receipts, []) });
  }).pipe(
    Effect.provideService(ServerActivation, Deferred.await(h.activation)),
    Effect.provide(
      FleetDispatcherReactorLive.pipe(
        Layer.provide(Layer.succeed(OrchestrationEngineService, h.engine)),
        Layer.provide(
          // The dispatcher reads the command read model fresh on every decision.
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Ref.get(h.model),
          }),
        ),
        Layer.provide(h.receiptBus),
        Layer.provide(NodeServices.layer),
      ),
    ),
  );
