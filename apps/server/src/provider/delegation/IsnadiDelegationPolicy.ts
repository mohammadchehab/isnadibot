import {
  ISNADI_TOOL_CATALOG,
  BotId,
  type BotSandbox,
  DelegationId,
  type GroupId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
  type IsnadiDelegationAccessGrant,
  IsnadiDelegationPhase,
  type IsnadiDelegationRecord,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  TurnId,
  isGroupBotMember,
  resolveBotSandbox,
} from "@isnadi/contracts";
import * as Schema from "effect/Schema";
import { PendingWaiterTimeoutError } from "../PendingWaiters.ts";

export const isPendingWaiterTimeout = Schema.is(PendingWaiterTimeoutError);

const botRefs = (bots: ReadonlyArray<{ readonly id: string; readonly name: string }>) =>
  bots.map((bot) => `${bot.name} (${bot.id})`).join(", ");

const BotRefs = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }));

/** A bot tool named a target that is neither a bot ID nor a member name or label. */
export class IsnadiDelegationUnknownBotError extends Schema.TaggedErrorClass<IsnadiDelegationUnknownBotError>()(
  "IsnadiDelegationUnknownBotError",
  { requested: Schema.String, members: BotRefs },
) {
  override get message(): string {
    return `No bot with the ID or name '${this.requested}' is available here. Pass a bot ID or exact name. Valid members: ${botRefs(this.members) || "none"}.`;
  }
}

/** A bot tool named a target that matches several members; it never picks one. */
export class IsnadiDelegationAmbiguousBotError extends Schema.TaggedErrorClass<IsnadiDelegationAmbiguousBotError>()(
  "IsnadiDelegationAmbiguousBotError",
  { requested: Schema.String, candidates: BotRefs },
) {
  override get message(): string {
    return `More than one bot matches '${this.requested}': ${botRefs(this.candidates)}. Pass the bot ID of the one you mean.`;
  }
}

export const isUnknownDelegationBot = Schema.is(IsnadiDelegationUnknownBotError);

export const isAmbiguousDelegationBot = Schema.is(IsnadiDelegationAmbiguousBotError);

export const TERMINAL_PHASES = new Set<IsnadiDelegationPhase["_tag"]>([
  "Completed",
  "Failed",
  "Canceled",
]);

export const phaseChildThreadId = (delegation: IsnadiDelegationRecord): ThreadId | null =>
  IsnadiDelegationPhase.guards.Queued(delegation.phase) ? null : delegation.phase.childThreadId;

export const phaseChildTurnId = (delegation: IsnadiDelegationRecord): TurnId | null =>
  IsnadiDelegationPhase.guards.Queued(delegation.phase) ? null : delegation.phase.childTurnId;

export const phaseStartedAt = (delegation: IsnadiDelegationRecord): string | null =>
  IsnadiDelegationPhase.guards.Queued(delegation.phase) ? null : delegation.phase.startedAt;

/**
 * The user message that started the parent turn, so clients can place the work
 * card under it. Null when the turn has no recorded request message; clients
 * then fall back to parentTurnId.
 */
export const parentTurnRequestMessageId = (
  thread: OrchestrationReadModel["threads"][number],
  turnId: TurnId,
): MessageId | null =>
  thread.latestTurn?.turnId === turnId ? (thread.latestTurn.requestMessageId ?? null) : null;

export interface IsnadiDelegationParent {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly botId: BotId;
  readonly parentDelegationId: DelegationId | null;
  readonly ancestorBotIds: ReadonlyArray<BotId>;
  readonly depth: number;
  readonly access: IsnadiDelegationAccessGrant;
}

export interface IsnadiDelegationChildOutcome {
  readonly state: "completed" | "failed" | "blocked";
  readonly turnId: TurnId | null;
  readonly summary?: string;
  readonly error?: string;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  };
}

export interface IsnadiDelegationRuntimeOptions {
  readonly readSnapshot: () => Promise<OrchestrationReadModel>;
  /**
   * The environment's default sandbox provider, read per delegation so a
   * settings change reaches work started after it. A bot with no sandbox of its
   * own uses it, exactly as a direct turn in that bot's chat does.
   */
  readonly defaultSandbox: () => Promise<BotSandbox>;
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Promise<{ readonly sequence: number } | void>;
  /**
   * Resolves with the child's turn outcome. Rejects with
   * `PendingWaiterTimeoutError` at the deadline, or after a bounded default
   * when the deadline is null, so a silent child never hangs the watch.
   */
  readonly awaitChild: (
    threadId: ThreadId,
    deadline: string | null,
  ) => Promise<IsnadiDelegationChildOutcome>;
  readonly interruptChild: (threadId: ThreadId, turnId: TurnId | null) => Promise<void>;
  readonly recordUsage?: (input: {
    readonly botId: BotId;
    readonly threadId: ThreadId;
    readonly turnId: TurnId | null;
    readonly category: "delegated";
    readonly inputTokens: number;
    readonly outputTokens: number;
  }) => Promise<void>;
  /**
   * Driver kind behind a provider instance, or null when the instance is
   * unknown. SendToAgent refuses a target whose instance is unknown or whose
   * driver cannot run delegated work before it creates the child thread.
   */
  readonly providerDriverKind?: (instanceId: ProviderInstanceId) => Promise<string | null>;
  /** Reports a background child watch that could not record its outcome. */
  readonly onWatchError?: (delegationId: DelegationId, cause: unknown) => void;
  /**
   * Reports a completed result the group chat did not show because the child
   * bot is no longer an active member or the group is gone. The result stays
   * recorded and reaches the parent on its next turn.
   */
  readonly onGroupResultSkipped?: (
    delegationId: DelegationId,
    reason: IsnadiGroupResultSkipReason,
  ) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

/**
 * Bot work started without a live parent turn. `Retry` repeats a Failed or
 * Canceled record; `Scheduled` is a routine run handing work from the owner
 * chat to another bot.
 */
export type IsnadiDelegationDispatch =
  | { readonly _tag: "Retry"; readonly delegationId: DelegationId }
  | {
      readonly _tag: "Scheduled";
      readonly parentThreadId: ThreadId;
      readonly parentBotId: BotId;
      readonly childBotId: BotId;
      readonly task: string;
      readonly expectedResult: string;
      readonly runtimeMode: IsnadiDelegationAccessGrant["runtimeMode"];
    };

/** How a record was started, when not by a bot tool call inside a live turn. */
export interface IsnadiDelegationOrigin {
  readonly trigger: IsnadiDelegationRecord["trigger"];
  readonly retryOfDelegationId: DelegationId | null;
  readonly anchorMessageId: MessageId | null;
}

export const isDispatchedDelegation = (delegation: IsnadiDelegationRecord) =>
  delegation.trigger !== "bot" || delegation.retryOfDelegationId !== null;

/** Why a group chat did not receive a finished delegation's result message. */
export type IsnadiGroupResultSkipReason = "bot_left_group" | "group_unavailable";

/** Returned by SendToAgent and MessageAgent as soon as the child turn is dispatched. */
export interface IsnadiDelegationHandle {
  readonly delegationId: DelegationId;
  readonly childThreadId: ThreadId;
  readonly childBotId: BotId;
  readonly name: string;
  readonly phase: "running";
}

// The child offers every memory scope; intersectDelegationAccess narrows it to
// what the parent holds and the request names, so an omitted request grants none.
export function childAccess(
  bot: OrchestrationBot,
  parentMcpServerIds: ReadonlyArray<IsnadiDelegationAccessGrant["enabledMcpServerIds"][number]>,
  requestedMemoryScopes: IsnadiDelegationAccessGrant["memoryScopes"] | undefined,
  defaultSandbox: BotSandbox,
): IsnadiDelegationAccessGrant {
  const resolved = resolveBotSandbox(bot.sandbox, defaultSandbox);

  return {
    allowedToolIds: ISNADI_TOOL_CATALOG.map((tool) => tool.id),
    memoryScopes: requestedMemoryScopes ?? [],
    sandbox: resolved.sandbox,
    runtimeMode: bot.runtimeMode,
    hasUserComputer: resolved.hasUserComputer,
    enabledMcpServerIds: parentMcpServerIds.filter(
      (serverId) => !bot.disabledMcpServerIds.includes(serverId),
    ),
    disabledMcpServerIds: bot.disabledMcpServerIds,
    approvalCeiling: "secrets",
  };
}

/**
 * Whether a handoff stays inside the space the user hired, which is what makes
 * it an internal move rather than a send across their trust boundary: same
 * space iff the acting bot and the target share a home group.
 *
 * The anchor is the **home** (`bot.groupId`), never a group roster. A roster is
 * forgeable: `CreateChannel` writes a group whose members the calling bot
 * chooses, and writes no home for any of them, so a roster test would let a bot
 * author its way into the silent allow this predicate exists to prevent.
 *
 * Homes are written by `bot.create`, `bot.update`, `group.member.assign` and
 * `group.delete`, and no tool can use any of them to move an *existing* bot
 * into the caller's space:
 * - `UpdateBotProfile` dispatches `bot.update`, but its input is name, title,
 *   label and description only, and tool input rejects excess properties, so
 *   it cannot carry a `groupId`. `isnadiToolCatalogWritesHomes` pins that.
 * - `CreateAgent` dispatches `bot.create` carrying `groupId`, which places a
 *   **brand-new** bot in the calling thread's own group. That grants a bot no
 *   reach over a bot that already has a home.
 * - No tool dispatches `group.member.assign` or `group.delete`.
 *
 * A thread with no group is a direct chat, and absence fails closed: a direct
 * chat implies consent for that bot, not for every bot in the environment.
 *
 * This predicate deliberately reads no group creator or origin field. Whether a
 * group was made by a person or by a bot is not what decides trust here: the
 * user's hire is recorded as each bot's home, and a bot that authors a group
 * still cannot author a home. Adding a creator check would refuse the channel
 * path — a bot opening a channel for bots the user already hired into one space
 * is exactly the internal move this allows — while proving nothing about the
 * homes. Leave it on homes.
 */
export function isSameSpaceHandoff(input: {
  readonly threadGroupId: GroupId | null;
  readonly actingBotHome: GroupId | null;
  readonly targetBotHome: GroupId | null;
}): boolean {
  if (input.threadGroupId === null) return false;

  return input.actingBotHome !== null && input.actingBotHome === input.targetBotHome;
}

/**
 * Resolves {@link isSameSpaceHandoff} against a read model: the thread supplies
 * the group the handoff happens in, and each bot supplies its home. Kept here
 * rather than at the session boundary so the forgery case — a bot-authored
 * channel whose roster names bots that live elsewhere — is a testable snapshot
 * instead of a live session.
 *
 * `targetBotId` is the tool's `botId` text, which is a bot ID *or* an exact
 * name, so it is matched through {@link matchDelegationTarget} first: a
 * name-addressed target has to reach the same answer as an id-addressed one, or
 * the boss delegating to a squad mate by name — the natural way an agent
 * addresses one — is the one path that still prompts. A target the delegation
 * itself could not resolve is not the same space, so the approval stays.
 */
export function isSameSpaceHandoffInSnapshot(
  snapshot: OrchestrationReadModel,
  input: {
    readonly threadId: ThreadId;
    readonly actingBotId: BotId;
    readonly targetBotId: BotId;
  },
): boolean {
  const thread = snapshot.threads.find(
    (candidate) => String(candidate.id) === String(input.threadId),
  );

  const homeOf = (botId: BotId) => snapshot.bots.find((bot) => bot.id === botId)?.groupId ?? null;

  const target = matchDelegationTarget(
    snapshot,
    { threadId: input.threadId, botId: input.actingBotId },
    input.targetBotId,
  );

  if (target.kind !== "bot") return false;

  return isSameSpaceHandoff({
    threadGroupId: thread?.groupId ?? null,
    actingBotHome: homeOf(input.actingBotId),
    targetBotHome: homeOf(target.botId),
  });
}

/**
 * A bot can take work from a group chat only when it is a member of that
 * group. A bot may belong to several groups, so membership is read from the
 * group, not from the bot's legacy `groupId`. A direct chat can reach any bot.
 */
export function isReachableFromThread(
  snapshot: OrchestrationReadModel,
  parentThread: OrchestrationReadModel["threads"][number],
  bot: OrchestrationBot,
): boolean {
  if (parentThread.groupId === null) return true;
  const group = snapshot.groups.find((candidate) => candidate.id === parentThread.groupId);

  return (
    group !== undefined &&
    group.members.some((member) => isGroupBotMember(member) && member.botId === bot.id)
  );
}

export function childInstructions(input: {
  readonly task: string;
  readonly expectedResult: string;
  readonly deadline: string | null;
  readonly context: string | undefined;
}): string {
  return [
    "This work was delegated from another bot chat.",
    `Task: ${input.task}`,
    `Expected result: ${input.expectedResult}`,
    ...(input.deadline ? [`Deadline: ${input.deadline}`] : []),
    ...(input.context?.trim() ? ["Context from the parent bot:", input.context.trim()] : []),
    "Return a concise final result to the parent chat. Report a concrete blocker or failure.",
  ].join("\n");
}

const sameText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

/** What a `TargetBotId` text — "bot id or exact name" — names, once resolved. */
export type DelegationTargetMatch =
  | { readonly kind: "bot"; readonly botId: BotId }
  | {
      readonly kind: "ambiguous";
      readonly requested: BotId;
      readonly candidates: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    }
  | {
      readonly kind: "unknown";
      readonly requested: BotId;
      readonly members: ReadonlyArray<{ readonly id: string; readonly name: string }>;
    };

/**
 * Matches the bot a delegation tool names. An exact bot ID wins; otherwise the
 * text is an exact name, then an exact label, matched only among active bots
 * reachable from the parent thread (never the calling bot), so a name never
 * reveals a bot outside the group. Several matches fail rather than pick one.
 * Returns the requested ID unchanged when it is a known bot, so the caller's
 * archived and group checks still give their own errors.
 *
 * This is the one place a `TargetBotId` text becomes a bot, so everything that
 * has to agree about *which* bot a handoff means reads it here: the delegation
 * itself, and the same-space approval predicate. It returns the outcome instead
 * of throwing because the approval predicate must fail closed rather than turn
 * a bad target into an error on a path the tool has not run yet.
 */
export function matchDelegationTarget(
  snapshot: OrchestrationReadModel,
  parent: Pick<IsnadiDelegationParent, "threadId" | "botId">,
  requested: BotId,
): DelegationTargetMatch {
  if (snapshot.bots.some((candidate) => candidate.id === requested)) {
    return { kind: "bot", botId: requested };
  }

  const parentThread = snapshot.threads.find((thread) => thread.id === parent.threadId);

  if (!parentThread) return { kind: "bot", botId: requested };

  const members = snapshot.bots.filter(
    (candidate) =>
      candidate.archivedAt === null &&
      candidate.id !== parent.botId &&
      isReachableFromThread(snapshot, parentThread, candidate),
  );

  const text = requested.trim().replace(/^@/, "");

  for (const field of ["name", "label"] as const) {
    const matches = members.filter((candidate) => {
      const value = candidate[field];

      return value !== null && sameText(value, text);
    });

    if (matches.length > 1) {
      return {
        kind: "ambiguous",
        requested,
        candidates: matches.map((match) => ({ id: match.id, name: match.name })),
      };
    }

    if (matches[0]) return { kind: "bot", botId: matches[0].id };
  }

  return {
    kind: "unknown",
    requested,
    members: members.map((member) => ({ id: member.id, name: member.name })),
  };
}

/** {@link matchDelegationTarget} for callers that want the bot or an error. */
export function resolveDelegationTargetId(
  snapshot: OrchestrationReadModel,
  parent: Pick<IsnadiDelegationParent, "threadId" | "botId">,
  requested: BotId,
): BotId {
  const match = matchDelegationTarget(snapshot, parent, requested);

  if (match.kind === "bot") return match.botId;

  if (match.kind === "ambiguous") {
    throw new IsnadiDelegationAmbiguousBotError({
      requested: match.requested,
      candidates: match.candidates,
    });
  }

  throw new IsnadiDelegationUnknownBotError({
    requested: match.requested,
    members: match.members,
  });
}
