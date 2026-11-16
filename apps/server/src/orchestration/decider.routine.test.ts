import {
  BotId,
  CommandId,
  EventId,
  ProjectId,
  RoutineId,
  RoutineRunId,
  ThreadId,
  type OrchestrationCommand,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { Predicate } from "effect";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";

import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-08-31T13:00:00.000Z";

it.layer(NodeServices.layer)("routine decider", (it) => {
  it.effect("creates an already-approved routine atomically", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "routine.create-approved",
          commandId: CommandId.make("command-routine-approved"),
          routineId: RoutineId.make("routine-approved"),
          botId: BotId.make("bot-1"),
          targetThreadId: ThreadId.make("thread-1"),
          job: "Daily brief",
          procedure: "Summarize this chat.",
          schedule: { kind: "weekdays", time: "09:00" },
          timezone: "America/New_York",
          skillAssignmentIds: [],
          connectorDependencies: [],
          projectId: ProjectId.make("project-1"),
          sandbox: "local",
          approvalPolicy: "approval-required",
          delegateToBotId: null,
          createdAt: NOW,
        },
        readModel: createEmptyReadModel(NOW),
      });

      const events = Array.isArray(event) ? event : [event];

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("routine.approved");

      if (events[0]?.type === "routine.approved") {
        expect(events[0].payload.routine).toMatchObject({
          lifecycle: "approved",
          procedureVersion: 1,
          approvalVersion: 1,
          enabled: false,
        });
      }
    }),
  );

  it.effect("deletes a routine and disables future runs", () =>
    Effect.gen(function* () {
      const readModel = createEmptyReadModel(NOW);

      const created = yield* decideOrchestrationCommand({
        command: {
          type: "routine.create-approved",
          commandId: CommandId.make("command-routine-create-for-delete"),
          routineId: RoutineId.make("routine-delete"),
          botId: BotId.make("bot-1"),
          targetThreadId: ThreadId.make("thread-1"),
          job: "Daily brief",
          procedure: "Summarize this chat.",
          schedule: { kind: "daily", time: "09:00" },
          timezone: "America/New_York",
          skillAssignmentIds: [],
          connectorDependencies: [],
          projectId: ProjectId.make("project-1"),
          sandbox: "local",
          approvalPolicy: "approval-required",
          delegateToBotId: null,
          createdAt: NOW,
        },
        readModel,
      });

      const createdEvent = Array.isArray(created) ? created[0] : created;

      const withRoutine = yield* projectEvent(readModel, {
        ...createdEvent,
        sequence: 1,
        eventId: EventId.make("event-routine-created-for-delete"),
      });

      const started = yield* decideOrchestrationCommand({
        command: {
          type: "routine.run",
          commandId: CommandId.make("command-routine-run-before-delete"),
          routineId: RoutineId.make("routine-delete"),
          runId: RoutineRunId.make("run-before-delete"),
          trigger: "manual",
          createdAt: NOW,
        },
        readModel: withRoutine,
      });

      const startedEvent = Array.isArray(started) ? started[0] : started;

      const withRun = yield* projectEvent(withRoutine, {
        ...startedEvent,
        sequence: 2,
        eventId: EventId.make("event-routine-run-before-delete"),
      });

      const deletedAt = "2026-08-31T14:00:00.000Z";

      const deleted = yield* decideOrchestrationCommand({
        command: {
          type: "routine.delete",
          commandId: CommandId.make("command-routine-delete"),
          routineId: RoutineId.make("routine-delete"),
          createdAt: deletedAt,
        },
        readModel: withRun,
      });

      const deletedEvent = Array.isArray(deleted) ? deleted[0] : deleted;

      expect(deletedEvent?.type).toBe("routine.deleted");

      if (deletedEvent?.type === "routine.deleted") {
        expect(deletedEvent.payload.routine).toMatchObject({
          id: RoutineId.make("routine-delete"),
          enabled: false,
          lifecycle: "deleted",
          nextRunAt: null,
          updatedAt: deletedAt,
          deletedAt,
        });
      }

      const afterDelete = yield* projectEvent(withRun, {
        ...deletedEvent,
        sequence: 3,
        eventId: EventId.make("event-routine-deleted"),
      });

      const completionError = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.run.complete",
            commandId: CommandId.make("command-routine-complete-after-delete"),
            routineId: RoutineId.make("routine-delete"),
            runId: RoutineRunId.make("run-before-delete"),
            result: { summary: "Late completion" },
            usageRef: null,
            nextRunAt: null,
            createdAt: "2026-08-31T14:01:00.000Z",
          },
          readModel: afterDelete,
        }),
      );

      expect(completionError.message).toContain("does not exist");
    }),
  );

  it.effect("rejects deletion when the routine does not exist", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.delete",
            commandId: CommandId.make("command-missing-routine-delete"),
            routineId: RoutineId.make("routine-missing"),
            createdAt: NOW,
          },
          readModel: createEmptyReadModel(NOW),
        }),
      );

      expect(error.message).toContain("Routine 'routine-missing' does not exist.");
    }),
  );

  it.effect("refuses to start a run that was canceled before it started", () =>
    Effect.gen(function* () {
      let readModel = createEmptyReadModel(NOW);
      let sequence = 0;

      const apply = (command: Parameters<typeof decideOrchestrationCommand>[0]["command"]) =>
        Effect.gen(function* () {
          const decided = yield* decideOrchestrationCommand({ command, readModel });

          for (const event of Array.isArray(decided) ? decided : [decided]) {
            sequence += 1;
            readModel = yield* projectEvent(readModel, {
              ...event,
              sequence,
              eventId: EventId.make(`event-canceled-start-${sequence}`),
            });
          }
        });

      const routineId = RoutineId.make("routine-canceled-start");
      const runId = RoutineRunId.make("run-canceled-start");
      yield* apply({
        type: "routine.create-approved",
        commandId: CommandId.make("command-canceled-start-create"),
        routineId,
        botId: BotId.make("bot-1"),
        targetThreadId: ThreadId.make("thread-1"),
        job: "Daily brief",
        procedure: "Summarize this chat.",
        schedule: { kind: "daily", time: "09:00" },
        timezone: "America/New_York",
        skillAssignmentIds: [],
        connectorDependencies: [],
        projectId: ProjectId.make("project-1"),
        sandbox: "local",
        approvalPolicy: "approval-required",
        delegateToBotId: BotId.make("bot-helper"),
        createdAt: NOW,
      });
      yield* apply({
        type: "routine.run",
        commandId: CommandId.make("command-canceled-start-run"),
        routineId,
        runId,
        trigger: "manual",
        createdAt: NOW,
      });
      yield* apply({
        type: "routine.run.cancel",
        commandId: CommandId.make("command-canceled-start-cancel"),
        routineId,
        runId,
        createdAt: NOW,
      });

      const error = yield* Effect.flip(
        apply({
          type: "routine.run.start",
          commandId: CommandId.make("command-canceled-start-start"),
          routineId,
          runId,
          threadRef: ThreadId.make("thread-helper"),
          startedAt: NOW,
        }),
      );

      expect(error.message).toContain("already ended with status 'canceled'");
      expect(readModel.routineRuns?.find((run) => run.id === runId)).toMatchObject({
        status: "canceled",
        threadRef: null,
      });
    }),
  );

  it.effect("keeps a completed run when a late cancellation arrives", () =>
    Effect.gen(function* () {
      let readModel = createEmptyReadModel(NOW);
      let sequence = 0;

      const apply = (command: Parameters<typeof decideOrchestrationCommand>[0]["command"]) =>
        Effect.gen(function* () {
          const decided = yield* decideOrchestrationCommand({ command, readModel });

          for (const event of Array.isArray(decided) ? decided : [decided]) {
            sequence += 1;
            readModel = yield* projectEvent(readModel, {
              ...event,
              sequence,
              eventId: EventId.make(`event-late-cancel-${sequence}`),
            });
          }
        });

      const routineId = RoutineId.make("routine-late-cancel");
      const runId = RoutineRunId.make("run-late-cancel");
      yield* apply({
        type: "routine.create-approved",
        commandId: CommandId.make("command-late-cancel-create"),
        routineId,
        botId: BotId.make("bot-1"),
        targetThreadId: ThreadId.make("thread-1"),
        job: "Daily brief",
        procedure: "Summarize this chat.",
        schedule: { kind: "daily", time: "09:00" },
        timezone: "America/New_York",
        skillAssignmentIds: [],
        connectorDependencies: [],
        projectId: ProjectId.make("project-1"),
        sandbox: "local",
        approvalPolicy: "approval-required",
        delegateToBotId: BotId.make("bot-helper"),
        createdAt: NOW,
      });
      yield* apply({
        type: "routine.run",
        commandId: CommandId.make("command-late-cancel-run"),
        routineId,
        runId,
        trigger: "manual",
        createdAt: NOW,
      });
      yield* apply({
        type: "routine.run.start",
        commandId: CommandId.make("command-late-cancel-start"),
        routineId,
        runId,
        threadRef: ThreadId.make("thread-helper"),
        startedAt: NOW,
      });
      yield* apply({
        type: "routine.run.complete",
        commandId: CommandId.make("command-late-cancel-complete"),
        routineId,
        runId,
        result: { summary: "Done" },
        usageRef: null,
        nextRunAt: null,
        createdAt: NOW,
      });

      const error = yield* Effect.flip(
        apply({
          type: "routine.run.cancel",
          commandId: CommandId.make("command-late-cancel-cancel"),
          routineId,
          runId,
          createdAt: NOW,
        }),
      );

      expect(error.message).toContain("already ended with status 'completed'");
      expect(readModel.routineRuns?.find((run) => run.id === runId)).toMatchObject({
        status: "completed",
      });
    }),
  );

  /*
   * TASK-305. Every situation below is reachable from a shipped routine screen:
   * web sends `expectedProcedureVersion` when saving an edit and
   * `procedureVersion` when approving (`apps/web/src/routes/_chat.bots.$botId.tsx`),
   * and both clients offer Enable and Run from the snapshot they hold, so the
   * server can be ahead of what the person is looking at. Each throw has to
   * carry a code, because the routine surfaces render the shared sentence from
   * `refusalMessages` and an uncoded one leaves them the invariant prose.
   */
  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  /** One routine, built by running the commands that reach the state under test. */
  const routineModel = (commands: ReadonlyArray<OrchestrationCommand>) =>
    Effect.gen(function* () {
      let readModel = createEmptyReadModel(NOW);
      let sequence = 0;

      for (const command of commands) {
        const decided = yield* decideOrchestrationCommand({ command, readModel });

        for (const event of Array.isArray(decided) ? decided : [decided]) {
          sequence += 1;
          readModel = yield* projectEvent(readModel, {
            ...event,
            sequence,
            eventId: EventId.make(`event-routine-refusal-${sequence}`),
          });
        }
      }

      return readModel;
    });

  const ROUTINE_ID = RoutineId.make("routine-refusal");

  const createApproved = (routineId: RoutineId = ROUTINE_ID): OrchestrationCommand => ({
    type: "routine.create-approved",
    commandId: CommandId.make(`command-${routineId}-create`),
    routineId,
    botId: BotId.make("bot-1"),
    targetThreadId: ThreadId.make("thread-1"),
    job: "Daily brief",
    procedure: "Summarize this chat.",
    schedule: { kind: "daily", time: "09:00" },
    timezone: "America/New_York",
    skillAssignmentIds: [],
    connectorDependencies: [],
    projectId: ProjectId.make("project-1"),
    sandbox: "local",
    approvalPolicy: "approval-required",
    delegateToBotId: null,
    createdAt: NOW,
  });

  /** A save. A draft resets `approvalVersion` to null and bumps the procedure version. */
  const draft = (options: {
    readonly tag?: string;
    readonly expectedProcedureVersion?: number;
  }): OrchestrationCommand => ({
    type: "routine.draft",
    commandId: CommandId.make(`command-${ROUTINE_ID}-${options.tag ?? "draft"}`),
    routineId: ROUTINE_ID,
    botId: BotId.make("bot-1"),
    targetThreadId: ThreadId.make("thread-1"),
    job: "Daily brief",
    procedure: "Summarize this chat, then post the highlights.",
    schedule: { kind: "daily", time: "09:00" },
    timezone: "America/New_York",
    skillAssignmentIds: [],
    connectorDependencies: [],
    projectId: ProjectId.make("project-1"),
    sandbox: "local",
    approvalPolicy: "approval-required",
    delegateToBotId: null,
    ...(options.expectedProcedureVersion === undefined
      ? {}
      : { expectedProcedureVersion: options.expectedProcedureVersion }),
    createdAt: NOW,
  });

  it.effect("refuses a draft save on a deleted routine with stale-view", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([
        createApproved(),
        {
          type: "routine.delete",
          commandId: CommandId.make("command-routine-refusal-delete"),
          routineId: ROUTINE_ID,
          createdAt: NOW,
        },
      ]);

      const error = yield* Effect.flip(
        decideOrchestrationCommand({ command: draft({}), readModel }),
      );

      // The record still exists with `lifecycle: deleted`, but neither client
      // shows it and nothing restores it, so a refresh is the whole remedy and
      // `stale-view` is the honest code.
      expect(refusalOf(error).refusal).toBe("stale-view");
    }),
  );

  it.effect("refuses a draft save written against a replaced procedure version", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([createApproved(), draft({})]);

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: draft({ tag: "second-draft", expectedProcedureVersion: 1 }),
          readModel,
        }),
      );

      expect(refusalOf(error).refusal).toBe("routine-version-conflict");
    }),
  );

  it.effect("refuses an approval that names a procedure version the routine has moved past", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([createApproved(), draft({})]);

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.approve",
            commandId: CommandId.make("command-routine-refusal-approve-stale"),
            routineId: ROUTINE_ID,
            procedureVersion: 1,
            createdAt: NOW,
          },
          readModel,
        }),
      );

      expect(refusalOf(error).refusal).toBe("routine-version-conflict");
    }),
  );

  it.effect("refuses an approval on a routine that does not exist with stale-view", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.approve",
            commandId: CommandId.make("command-routine-refusal-approve-missing"),
            routineId: ROUTINE_ID,
            procedureVersion: 1,
            createdAt: NOW,
          },
          readModel: createEmptyReadModel(NOW),
        }),
      );

      expect(refusalOf(error).refusal).toBe("stale-view");
    }),
  );

  it.effect("refuses to enable a routine whose current procedure is unapproved", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([createApproved(), draft({})]);

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.enable",
            commandId: CommandId.make("command-routine-refusal-enable"),
            routineId: ROUTINE_ID,
            createdAt: NOW,
          },
          readModel,
        }),
      );

      expect(refusalOf(error).refusal).toBe("routine-procedure-unapproved");
    }),
  );

  it.effect("refuses to enable a routine that does not exist with stale-view", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.enable",
            commandId: CommandId.make("command-routine-refusal-enable-missing"),
            routineId: ROUTINE_ID,
            createdAt: NOW,
          },
          readModel: createEmptyReadModel(NOW),
        }),
      );

      expect(refusalOf(error).refusal).toBe("stale-view");
    }),
  );

  it.effect("refuses a manual run when the current procedure is unapproved", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([createApproved(), draft({})]);

      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "routine.run",
            commandId: CommandId.make("command-routine-refusal-run"),
            routineId: ROUTINE_ID,
            runId: RoutineRunId.make("run-routine-refusal"),
            trigger: "manual",
            createdAt: NOW,
          },
          readModel,
        }),
      );

      expect(refusalOf(error).refusal).toBe("routine-procedure-unapproved");
    }),
  );

  it.effect("still allows a dry run on a routine whose current procedure is unapproved", () =>
    Effect.gen(function* () {
      const readModel = yield* routineModel([createApproved(), draft({})]);

      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "routine.run",
          commandId: CommandId.make("command-routine-refusal-dry-run"),
          routineId: ROUTINE_ID,
          runId: RoutineRunId.make("run-routine-refusal-dry"),
          trigger: "dry-run",
          createdAt: NOW,
        },
        readModel,
      });

      // The guard above is the only one that skips a dry run, so a refusal
      // leaking into it would break the one way a person can test an edit
      // before approving it.
      const events = Array.isArray(decided) ? decided : [decided];

      expect(events.map((event) => event.type)).toContain("routine.running");
    }),
  );
});
