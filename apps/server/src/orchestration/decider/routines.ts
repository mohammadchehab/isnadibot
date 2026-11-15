import * as Match from "effect/Match";
import { type OrchestrationCommand, type OrchestrationReadModel } from "@isnadi/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import {
  type OrchestrationCommandInvariantError,
  internalInvariantError,
  noShippedSurfaceInvariantError,
  pendingRefusalInvariantError,
  refusedInvariantError,
} from "../Errors.ts";
import type { OrchestrationDispatchActor } from "../Services/OrchestrationEngine.ts";
import { nextScheduledFor } from "../../routines/schedule.ts";
import { withEventBase, type DecideOrchestrationCommandResult } from "./eventBase.ts";

export const decideRoutines = Effect.fn("decideRoutines")(function* ({
  command,
  readModel,
}: {
  readonly command: Extract<
    OrchestrationCommand,
    {
      type:
        | "routine.create-approved"
        | "routine.draft"
        | "routine.approve"
        | "routine.enable"
        | "routine.pause"
        | "routine.run"
        | "routine.run.scheduled"
        | "routine.run.start"
        | "routine.run.block"
        | "routine.run.fail"
        | "routine.run.complete"
        | "routine.run.cancel"
        | "routine.delete"
        | "routine.skill.assign"
        | "routine.skill.unassign";
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
    case "routine.create-approved": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing !== undefined) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' already exists.`,
          reason:
            "`routine.create-approved` is a member of `InternalRoutineCommand` (packages/contracts/src/routines.ts), so no client can dispatch it.",
        });
      }

      const routine = {
        id: command.routineId,
        botId: command.botId,
        targetThreadId: command.targetThreadId,
        job: command.job,
        procedure: command.procedure,
        schedule: command.schedule,
        timezone: command.timezone,
        skillAssignmentIds: command.skillAssignmentIds,
        connectorDependencies: command.connectorDependencies,
        projectId: command.projectId,
        sandbox: command.sandbox,
        approvalPolicy: command.approvalPolicy,
        delegateToBotId: command.delegateToBotId,
        procedureVersion: 1,
        approvalVersion: 1,
        enabled: false as const,
        lifecycle: "approved" as const,
        nextRunAt: null,
        lastRunAt: null,
        latestResult: null,
        latestFailure: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
        deletedAt: null,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.approved",
        payload: { routine },
      };
    }

    case "routine.draft": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing?.lifecycle === "deleted") {
        return yield* pendingRefusalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' is deleted.`,
          reason:
            "The routine record still exists with `lifecycle: deleted`, so `stale-view` would tell the user it is gone when it is present; no existing code names a deleted routine.",
          ticket: "TASK-305",
        });
      }

      if (
        existing !== undefined &&
        command.expectedProcedureVersion !== undefined &&
        command.expectedProcedureVersion !== existing.procedureVersion
      ) {
        return yield* pendingRefusalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' procedure version changed.`,
          reason:
            "The draft was written against a procedure version another device has since replaced; no existing code names a version conflict.",
          ticket: "TASK-305",
        });
      }

      const procedureVersion = (existing?.procedureVersion ?? 0) + 1;

      const routine = {
        id: command.routineId,
        botId: command.botId,
        targetThreadId: command.targetThreadId,
        job: command.job,
        procedure: command.procedure,
        schedule: command.schedule,
        timezone: command.timezone,
        skillAssignmentIds: command.skillAssignmentIds,
        connectorDependencies: command.connectorDependencies,
        projectId: command.projectId,
        sandbox: command.sandbox,
        approvalPolicy: command.approvalPolicy,
        delegateToBotId: command.delegateToBotId,
        procedureVersion,
        approvalVersion: null,
        enabled: false as const,
        lifecycle: "draft" as const,
        nextRunAt: null,
        lastRunAt: existing?.lastRunAt ?? null,
        latestResult: existing?.latestResult ?? null,
        latestFailure: existing?.latestFailure ?? null,
        createdAt: existing?.createdAt ?? command.createdAt,
        updatedAt: command.createdAt,
        deletedAt: null,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.drafted",
        payload: { routine },
      };
    }

    case "routine.approve": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (
        existing === undefined ||
        existing.lifecycle === "deleted" ||
        existing.procedureVersion !== command.procedureVersion
      ) {
        return yield* pendingRefusalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' cannot approve procedure version ${command.procedureVersion}.`,
          reason:
            "The approval names a procedure version the routine no longer holds; no existing code names a version conflict.",
          ticket: "TASK-305",
        });
      }

      const routine = {
        ...existing,
        approvalVersion: existing.procedureVersion,
        enabled: false,
        lifecycle: "approved" as const,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.approved",
        payload: { routine },
      };
    }

    case "routine.enable": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (
        existing === undefined ||
        existing.lifecycle === "deleted" ||
        existing.approvalVersion !== existing.procedureVersion
      ) {
        return yield* pendingRefusalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' requires approval before enable.`,
          reason:
            "The routine's procedure has been edited since it was approved, so the user has to approve it again; no existing code names that remedy.",
          ticket: "TASK-305",
        });
      }

      const routine = {
        ...existing,
        enabled: true,
        lifecycle: "enabled" as const,
        nextRunAt: nextScheduledFor(
          existing.schedule,
          existing.timezone,
          Date.parse(command.createdAt),
        ),
        latestFailure: null,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.enabled",
        payload: { routine },
      };
    }

    case "routine.pause": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined || existing.lifecycle === "deleted") {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
          refusal: "stale-view",
        });
      }

      const routine = {
        ...existing,
        enabled: false,
        lifecycle: "paused" as const,
        nextRunAt: null,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.paused",
        payload: { routine },
      };
    }

    case "routine.run":
    case "routine.run.scheduled": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined || existing.lifecycle === "deleted") {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
          refusal: "stale-view",
        });
      }

      if (command.type === "routine.run.scheduled" && !existing.enabled) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' is not enabled.`,
          reason:
            "Only `routine.run.scheduled`, a member of `InternalRoutineCommand`, can reach this arm; the scheduler firing for a disabled routine is a server race, not a user action.",
        });
      }

      if (command.trigger !== "dry-run" && existing.approvalVersion !== existing.procedureVersion) {
        return yield* pendingRefusalInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' procedure approval is stale.`,
          reason:
            "The routine still exists and is approved, but for an older procedure version, so `stale-view` would say it is gone; the remedy is to approve the current version, which no existing code names.",
          ticket: "TASK-305",
        });
      }

      if ((readModel.routineRuns ?? []).some((run) => run.id === command.runId)) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' already exists.`,
          refusal: "already-exists",
        });
      }

      const runBase = {
        id: command.runId,
        routineId: command.routineId,
        procedureVersion: existing.procedureVersion,
        status: "queued" as const,
        result: null,
        failure: null,
        usageRef: null,
        threadRef: null,
        startedAt: null,
        completedAt: null,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      const run =
        command.type === "routine.run.scheduled"
          ? {
              ...runBase,
              trigger: command.trigger,
              scheduledFor: command.scheduledFor,
            }
          : { ...runBase, trigger: command.trigger, scheduledFor: null };

      const routine = {
        ...existing,
        lifecycle: "running" as const,
        lastRunAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.running",
        payload: { routine, run },
      };
    }

    case "routine.run.start":
    case "routine.run.block":
    case "routine.run.fail":
    case "routine.run.complete":
    case "routine.run.cancel": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      const existingRun = (readModel.routineRuns ?? []).find((run) => run.id === command.runId);

      if (existing === undefined || existing.lifecycle === "deleted" || existingRun === undefined) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' does not exist.`,
          reason:
            "`routine.run.start`, `.block`, `.fail`, `.complete` and `.cancel` are all members of `InternalRoutineCommand` (packages/contracts/src/routines.ts), so no client can dispatch them.",
        });
      }

      // A run canceled or settled before it started stays ended, and a
      // cancellation never overwrites a run that already ended.
      if (
        (command.type === "routine.run.start" || command.type === "routine.run.cancel") &&
        existingRun.status !== "queued" &&
        existingRun.status !== "waiting-for-approval" &&
        existingRun.status !== "running"
      ) {
        return yield* internalInvariantError({
          commandType: command.type,
          detail: `Routine run '${command.runId}' already ended with status '${existingRun.status}'.`,
          reason:
            "The run lifecycle commands are members of `InternalRoutineCommand` (packages/contracts/src/routines.ts); a settled run being restarted is the server double-firing, not a user action.",
        });
      }

      const occurredAt =
        command.type === "routine.run.start" ? command.startedAt : command.createdAt;

      const run = Match.value(command).pipe(
        Match.when({ type: "routine.run.start" }, (command) => ({
          ...existingRun,
          status: "running" as const,
          threadRef: command.threadRef,
          startedAt: command.startedAt,
          updatedAt: command.startedAt,
        })),
        Match.when({ type: "routine.run.block" }, (command) => ({
          ...existingRun,
          status: "blocked" as const,
          failure: command.failure,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.when({ type: "routine.run.fail" }, (command) => ({
          ...existingRun,
          status: "failed" as const,
          failure: command.failure,
          usageRef: command.usageRef,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.when({ type: "routine.run.complete" }, (command) => ({
          ...existingRun,
          status: "completed" as const,
          result: command.result,
          usageRef: command.usageRef,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
        Match.orElse((command) => ({
          ...existingRun,
          status: "canceled" as const,
          completedAt: command.createdAt,
          updatedAt: command.createdAt,
        })),
      );

      const terminal = command.type !== "routine.run.start";

      const blockedOrFailed =
        command.type === "routine.run.block" || command.type === "routine.run.fail";

      const routine = {
        ...existing,
        enabled: blockedOrFailed ? false : existing.enabled,
        lifecycle: Match.value(command).pipe(
          Match.when({ type: "routine.run.start" }, (_command) => "running" as const),
          Match.when({ type: "routine.run.block" }, (_command) => "blocked" as const),
          Match.when({ type: "routine.run.fail" }, (_command) => "failed" as const),
          Match.orElse((command) =>
            command.type === "routine.run.complete" && existing.enabled
              ? ("enabled" as const)
              : command.type === "routine.run.complete"
                ? ("completed" as const)
                : existing.enabled
                  ? ("enabled" as const)
                  : ("paused" as const),
          ),
        ),
        nextRunAt: Match.value(command).pipe(
          Match.when({ type: "routine.run.complete" }, (command) => command.nextRunAt),
          Match.orElse((_command) => (blockedOrFailed ? null : existing.nextRunAt)),
        ),
        lastRunAt: terminal ? occurredAt : existing.lastRunAt,
        latestResult:
          command.type === "routine.run.complete" ? command.result : existing.latestResult,
        latestFailure:
          command.type === "routine.run.block" || command.type === "routine.run.fail"
            ? command.failure
            : existing.latestFailure,
        updatedAt: occurredAt,
      };

      const type = Match.value(command).pipe(
        Match.when({ type: "routine.run.start" }, (_command) => "routine.running" as const),
        Match.when({ type: "routine.run.block" }, (_command) => "routine.blocked" as const),
        Match.when({ type: "routine.run.fail" }, (_command) => "routine.failed" as const),
        Match.when({ type: "routine.run.complete" }, (_command) => "routine.completed" as const),
        Match.orElse((_command) => "routine.run-canceled" as const),
      );

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt,
          commandId: command.commandId,
        })),
        type,
        payload: { routine, run },
      };
    }

    case "routine.delete": {
      const existing = (readModel.routines ?? []).find(
        (routine) => routine.id === command.routineId,
      );

      if (existing === undefined) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Routine '${command.routineId}' does not exist.`,
          refusal: "stale-view",
        });
      }

      const routine = {
        ...existing,
        enabled: false,
        lifecycle: "deleted" as const,
        nextRunAt: null,
        updatedAt: command.createdAt,
        deletedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "routine",
          aggregateId: command.routineId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "routine.deleted",
        payload: { routine },
      };
    }

    case "routine.skill.assign": {
      if (
        (readModel.skillAssignments ?? []).some(
          (assignment) => assignment.id === command.assignmentId,
        )
      ) {
        return yield* refusedInvariantError({
          commandType: command.type,
          detail: `Skill assignment '${command.assignmentId}' already exists.`,
          refusal: "already-exists",
        });
      }

      const assignment = {
        id: command.assignmentId,
        botId: command.botId,
        skillId: command.skillId,
        name: command.name,
        description: command.description,
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };

      return {
        ...(yield* withEventBase({
          aggregateKind: "skill-assignment",
          aggregateId: command.assignmentId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "skill-assignment.assigned",
        payload: { assignment },
      };
    }

    case "routine.skill.unassign": {
      const assignment = (readModel.skillAssignments ?? []).find(
        (entry) => entry.id === command.assignmentId && entry.botId === command.botId,
      );

      if (assignment === undefined) {
        return yield* noShippedSurfaceInvariantError({
          commandType: command.type,
          detail: `Skill assignment '${command.assignmentId}' does not exist.`,
          reason:
            "`routine.skill.unassign` is in the client command union but no shipped screen dispatches it: `assignSkill` is wired in `packages/client-runtime/src/state/routines.ts` and called from web, while unassign has no control on web, desktop or mobile today.",
        });
      }

      return {
        ...(yield* withEventBase({
          aggregateKind: "skill-assignment",
          aggregateId: command.assignmentId,
          occurredAt: command.createdAt,
          commandId: command.commandId,
        })),
        type: "skill-assignment.unassigned",
        payload: {
          assignmentId: command.assignmentId,
          botId: command.botId,
          removedAt: command.createdAt,
        },
      };
    }
  }
});
