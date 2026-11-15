import { IsnadiDelegationPhase } from "@isnadi/contracts";
import * as Predicate from "effect/Predicate";
import {
  ISNADI_DELEGATION_MAX_CONCURRENCY,
  ISNADI_DELEGATION_MAX_DEPTH,
  acknowledgeIsnadiDelegation,
  isIsnadiDelegationResultPending,
  releaseIsnadiDelegationAcknowledgement,
  type IsnadiDelegationRecord,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import * as NodeUtil from "node:util";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import {
  OrchestrationCommandInvariantError,
  internalInvariantError,
  refusedInvariantError,
  noShippedSurfaceInvariantError,
} from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import {
  requireBotNotArchived,
  requireDelegation,
  requireDelegationAbsent,
  requireThread,
} from "../commandInvariants.ts";
import {
  delegationChildThreadId,
  TERMINAL_DELEGATION_PHASES,
  withEventBase,
  hasSameDelegationOwnership,
  delegationChildTurnId,
  isDelegationTransitionAllowed,
  type DecideOrchestrationCommandResult,
} from "./eventBase.ts";

export const decideDelegations = Effect.fn("decideDelegations")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    {
      type: "delegation.create" | "delegation.state.set" | "delegation.cancel" | "delegation.retry";
    }
  >;
  readonly readModel: OrchestrationReadModel;
  readonly actor?: OrchestrationDispatchActor;
}): Effect.fn.Return<
  DecideOrchestrationCommandResult,
  OrchestrationCommandInvariantError | PlatformError.PlatformError,
  Crypto.Crypto
> {
  switch (command.type) {
    case "delegation.create": {
      const delegation = command.delegation;
      yield* requireDelegationAbsent({
        readModel,
        command,
        delegationId: delegation.delegationId,
      });
      yield* requireBotNotArchived({ readModel, command, botId: delegation.parentBotId });
      yield* requireBotNotArchived({ readModel, command, botId: delegation.childBotId });
      yield* requireThread({ readModel, command, threadId: delegation.parentThreadId });
      const createdChildThreadId = delegationChildThreadId(delegation.phase);

      if (createdChildThreadId !== null) {
        yield* requireThread({ readModel, command, threadId: createdChildThreadId });
      }

      if (delegation.billedBotId !== delegation.childBotId) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${delegation.delegationId}' must bill child bot '${delegation.childBotId}'.`,
          reason:
            "delegation.create is in InternalOrchestrationCommand, so no client can dispatch it: the only dispatcher is the server's own delegation runtime, which builds the record and stamps billedBotId from the child bot it is about to run.",
        });
      }

      const parentDelegation =
        delegation.parentDelegationId === null
          ? null
          : yield* requireDelegation({
              readModel,
              command,
              delegationId: delegation.parentDelegationId,
            });

      if (parentDelegation !== null && parentDelegation.childBotId !== delegation.parentBotId) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Parent delegation '${parentDelegation.delegationId}' does not belong to bot '${delegation.parentBotId}'.`,
          reason:
            "delegation.create is internal, and the runtime derives parentDelegationId from the parent thread's own record rather than from user input, so a parent naming a different bot is a server bug in that lookup.",
        });
      }

      const expectedDepth = parentDelegation === null ? 1 : parentDelegation.depth + 1;

      const expectedAncestorBotIds =
        parentDelegation === null
          ? [delegation.parentBotId]
          : [...parentDelegation.ancestorBotIds, delegation.parentBotId];

      if (
        expectedDepth > ISNADI_DELEGATION_MAX_DEPTH ||
        delegation.depth !== expectedDepth ||
        !NodeUtil.isDeepStrictEqual(delegation.ancestorBotIds, expectedAncestorBotIds)
      ) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${delegation.delegationId}' has an invalid ancestor chain or depth.`,
          reason:
            "delegation.create is internal; depth and ancestorBotIds are computed by the delegation runtime from the parent record it just read, never supplied by a client, so a mismatch means the runtime built the chain wrong.",
        });
      }

      if (delegation.ancestorBotIds.includes(delegation.childBotId)) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Delegation '${delegation.delegationId}' would create a bot cycle.`,
          refusal: "delegation-would-cycle",
        });
      }

      const activeDelegationCount = readModel.delegations.filter(
        (candidate) =>
          candidate.parentBotId === delegation.parentBotId &&
          !TERMINAL_DELEGATION_PHASES.has(candidate.phase._tag),
      ).length;

      if (activeDelegationCount >= ISNADI_DELEGATION_MAX_CONCURRENCY) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Bot '${delegation.parentBotId}' already has ${activeDelegationCount} active delegations.`,
          refusal: "delegation-limit-reached",
        });
      }

      if (!Predicate.isTagged(delegation.phase, "Queued")) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: "New delegations must start queued.",
          reason:
            "delegation.create is internal and the runtime always creates the record in Queued, so a non-Queued payload means the trusted path built the wrong phase rather than that a user chose one.",
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "delegation",
          aggregateId: delegation.delegationId,
          occurredAt: delegation.createdAt,
          commandId: command.commandId,
        })),
        type: "delegation.created",
        payload: { delegation },
      };
    }

    case "delegation.state.set": {
      const current = yield* requireDelegation({
        readModel,
        command,
        delegationId: command.delegation.delegationId,
      });

      const next = command.delegation;

      if (!hasSameDelegationOwnership(current, next)) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${next.delegationId}' ownership and access fields are immutable.`,
          reason:
            "delegation.state.set is in InternalOrchestrationCommand, so no client can dispatch it: only startup reconciliation, the delegation runtime and the provider-command layer set state, and each carries the ownership fields forward from the record it read.",
        });
      }

      const currentChildThreadId = delegationChildThreadId(current.phase);
      const currentChildTurnId = delegationChildTurnId(current.phase);
      const nextChildThreadId = delegationChildThreadId(next.phase);
      const nextChildTurnId = delegationChildTurnId(next.phase);

      if (
        (currentChildThreadId !== null && nextChildThreadId !== currentChildThreadId) ||
        (currentChildTurnId !== null && nextChildTurnId !== currentChildTurnId)
      ) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${next.delegationId}' child ownership is immutable once assigned.`,
          reason:
            "delegation.state.set is internal, and its writers carry childThreadId and childTurnId forward unchanged; reassigning them would mean a server writer rebuilt the record instead of updating the one it read.",
        });
      }

      if (
        Predicate.isTagged(next.phase, "Completed") &&
        (next.phase.result.childThreadId !== next.phase.childThreadId ||
          next.phase.result.childTurnId !== next.phase.childTurnId)
      ) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${next.delegationId}' result must come from its child thread and turn.`,
          reason:
            "delegation.state.set is internal, and the Completed phase is built by the delegation runtime from the child thread and turn it just ran, so a result naming anything else is the runtime reporting the wrong run.",
        });
      }

      if (nextChildThreadId !== null) {
        yield* requireThread({ readModel, command, threadId: nextChildThreadId });
      }

      if (!(Date.parse(next.updatedAt) >= Date.parse(current.updatedAt))) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${next.delegationId}' cannot move updatedAt backward.`,
          reason:
            "delegation.state.set is internal, and updatedAt is stamped by the server's clock on every write, so a backward timestamp means a server writer used a stale clock rather than that a client sent one.",
        });
      }

      if (current.phase._tag === next.phase._tag) {
        const assignsChildOwnership =
          (currentChildThreadId === null && nextChildThreadId !== null) ||
          (currentChildTurnId === null && nextChildTurnId !== null);

        const changesOnlyChildOwnership = NodeUtil.isDeepStrictEqual(current, {
          ...next,
          phase: Predicate.isTagged(next.phase, "Queued")
            ? next.phase
            : {
                ...next.phase,
                childThreadId: currentChildThreadId,
                childTurnId: currentChildTurnId,
              },
          updatedAt: current.updatedAt,
        });

        // CheckAgent delivers a finished result by stamping acknowledgedAt.
        // That stamp is the only other same-phase change allowed.
        const acknowledgesOnly =
          isIsnadiDelegationResultPending(current) &&
          (Predicate.isTagged(next.phase, "Completed") ||
            Predicate.isTagged(next.phase, "Failed")) &&
          next.phase.acknowledgedAt !== null &&
          NodeUtil.isDeepStrictEqual(
            acknowledgeIsnadiDelegation(current, next.phase.acknowledgedAt),
            next,
          );

        // A turn start that fails before its provider reads the results
        // hands them back, clearing only the stamp.
        const released = releaseIsnadiDelegationAcknowledgement(current);
        const releasesOnly = released !== current && NodeUtil.isDeepStrictEqual(released, next);

        if (
          !NodeUtil.isDeepStrictEqual(current, next) &&
          !acknowledgesOnly &&
          !releasesOnly &&
          (!assignsChildOwnership || !changesOnlyChildOwnership)
        ) {
          return yield* internalInvariantError({
            commandType: command.type,
            detail: `Delegation '${next.delegationId}' cannot change data without a state transition.`,
            reason:
              "delegation.state.set is internal, and every server writer builds the next record from the one it read, so a same-phase data change means a writer rebuilt it instead of carrying it forward.",
          });
        }
      } else if (!isDelegationTransitionAllowed(current.phase._tag, next.phase._tag)) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Delegation '${next.delegationId}' cannot transition from '${current.phase._tag}' to '${next.phase._tag}'.`,
          reason:
            "delegation.state.set is internal: a client can dispatch only delegation.cancel and delegation.retry, never a state set, and ISNADI_DELEGATION_TRANSITIONS is server-owned, so no client-chosen pair of phases can reach this guard.",
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "delegation",
          aggregateId: next.delegationId,
          occurredAt: next.updatedAt,
          commandId: command.commandId,
        })),
        type: "delegation.updated",
        payload: { delegation: next },
      };
    }

    case "delegation.cancel": {
      const current = yield* requireDelegation({
        readModel,
        command,
        delegationId: command.delegationId,
      });

      const canceledAt =
        Date.parse(command.createdAt) >= Date.parse(current.updatedAt)
          ? command.createdAt
          : current.updatedAt;

      const delegation: IsnadiDelegationRecord = command.keep
        ? { ...current, keep: true, updatedAt: canceledAt }
        : TERMINAL_DELEGATION_PHASES.has(current.phase._tag)
          ? current
          : {
              ...current,
              phase: IsnadiDelegationPhase.cases.Canceled.make({
                childThreadId: delegationChildThreadId(current.phase),
                childTurnId: delegationChildTurnId(current.phase),
                startedAt: "startedAt" in current.phase ? current.phase.startedAt : null,
                completedAt: canceledAt,
                canceledBy: "user",
              }),
              updatedAt: canceledAt,
            };

      return {
        ...(yield* withEventBase({
          aggregateKind: "delegation",
          aggregateId: command.delegationId,
          occurredAt: delegation.updatedAt,
          commandId: command.commandId,
        })),
        type: "delegation.updated",
        payload: { delegation },
      };
    }

    case "delegation.retry": {
      const original = yield* requireDelegation({
        readModel,
        command,
        delegationId: command.delegationId,
      });

      if (
        !Predicate.isTagged(original.phase, "Failed") &&
        !Predicate.isTagged(original.phase, "Canceled")
      ) {
        return yield* noShippedSurfaceInvariantError({
          commandType: command.type,
          detail: "Only failed or canceled bot work can be retried.",
          // The asymmetry with the already-retried guard below is why one of the
          // pair is an exclusion and the other a code, so it is stated here.
          reason:
            "DelegationRetryCommand is client-dispatchable and carries only the delegation id, so a client can send a retry for a non-terminal phase; no shipped surface does, because the retry button is offered only when the record's own phase is Failed or Canceled (delegationActions). This exclusion ends the moment a surface offers retry off a non-terminal phase, which must code it first. The next guard checks the rest of the delegations collection instead, which another device can add to, and that is why it carries stale-view while this one carries no code.",
        });
      }

      if (
        readModel.delegations.some(
          (candidate) => candidate.retryOfDelegationId === original.delegationId,
        )
      ) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: "This bot work was already retried. Use the newer card instead.",
          // The record itself is unchanged — a terminal phase never moves. What
          // this device's view is missing is the sibling retry another device
          // created, so the remedy is a refresh, and `isDelegationSuperseded`
          // gates the retry button on this same predicate.
          refusal: "stale-view",
        });
      }

      yield* requireThread({ readModel, command, threadId: original.parentThreadId });
      yield* requireBotNotArchived({ readModel, command, botId: original.parentBotId });
      yield* requireBotNotArchived({ readModel, command, botId: original.childBotId });

      const activeDelegationCount = readModel.delegations.filter(
        (candidate) =>
          candidate.parentBotId === original.parentBotId &&
          !TERMINAL_DELEGATION_PHASES.has(candidate.phase._tag),
      ).length;

      if (activeDelegationCount >= ISNADI_DELEGATION_MAX_CONCURRENCY) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `This bot already has ${activeDelegationCount} bot work items running. Wait for one to finish, then retry.`,
          // Same reason-kind as the create-time cap above: this bot has too many
          // bot work items in flight. One reason-kind, one code.
          refusal: "delegation-limit-reached",
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "delegation",
          aggregateId: command.delegationId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "delegation.retry-requested",
        payload: {
          delegationId: command.delegationId,
          parentThreadId: original.parentThreadId,
          createdAt: command.createdAt,
        },
      };
    }
  }
});
