import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClientOrchestrationCommand, CommandId, DelegationId } from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
import {
  makeDelegation,
  CHILD_THREAD_ID,
  CHILD_TURN_ID,
  NOW,
  LATER,
  makeReadModel,
  PARENT_THREAD_ID,
} from "./test-support/DelegationDeciderFixtures.ts";

/** Whether a payload survives the contract a client dispatch is decoded against. */
const clientCanDispatch = Schema.is(ClientOrchestrationCommand);

it.layer(NodeServices.layer)("delegation decider", (it) => {
  it.effect("requests a retry of failed or canceled work without touching the original", () =>
    Effect.gen(function* () {
      const failed = makeDelegation({
        phase: {
          _tag: "Failed",
          childThreadId: CHILD_THREAD_ID,
          childTurnId: CHILD_TURN_ID,
          startedAt: NOW,
          completedAt: LATER,
          failure: { failureCode: "child_failed", message: "The child failed." },
          acknowledgedAt: null,
        },
        updatedAt: LATER,
      });

      const readModel = makeReadModel([failed]);

      const decided = yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry"),
          delegationId: failed.delegationId,
          createdAt: LATER,
        },
      });

      const events = Array.isArray(decided) ? decided : [decided];
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "delegation.retry-requested",
        aggregateKind: "delegation",
        aggregateId: failed.delegationId,
        payload: { delegationId: failed.delegationId, parentThreadId: PARENT_THREAD_ID },
      });

      const projected = yield* projectEvent(readModel, {
        ...events[0]!,
        sequence: readModel.snapshotSequence + 1,
      });

      expect(projected.delegations).toEqual([failed]);
    }),
  );

  it.effect("refuses retrying open work, retrying past the cap, and retrying twice", () =>
    Effect.gen(function* () {
      const running = makeDelegation({
        phase: {
          _tag: "Running",
          childThreadId: CHILD_THREAD_ID,
          childTurnId: null,
          startedAt: NOW,
          progress: null,
        },
      });

      const openError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([running]),
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry-open"),
          delegationId: running.delegationId,
          createdAt: LATER,
        },
      }).pipe(Effect.flip);

      expect(String(openError)).toContain("Only failed or canceled bot work can be retried.");

      const canceled = makeDelegation({
        delegationId: DelegationId.make("delegation-canceled"),
        phase: {
          _tag: "Canceled",
          childThreadId: null,
          childTurnId: null,
          startedAt: null,
          completedAt: LATER,
          canceledBy: "user",
        },
      });

      const active = [1, 2, 3].map((index) =>
        makeDelegation({ delegationId: DelegationId.make(`delegation-active-${index}`) }),
      );

      const capError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([canceled, ...active]),
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry-cap"),
          delegationId: canceled.delegationId,
          createdAt: LATER,
        },
      }).pipe(Effect.flip);

      expect(String(capError)).toContain(
        "This bot already has 3 bot work items running. Wait for one to finish, then retry.",
      );

      const successor = makeDelegation({
        delegationId: DelegationId.make("delegation-retry-of-canceled"),
        retryOfDelegationId: canceled.delegationId,
      });

      const supersededError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([canceled, successor]),
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry-superseded"),
          delegationId: canceled.delegationId,
          createdAt: LATER,
        },
      }).pipe(Effect.flip);

      expect(String(supersededError)).toContain(
        "This bot work was already retried. Use the newer card instead.",
      );
    }),
  );

  // The architect ruled the two neighbouring guards apart: one reads this
  // record's own phase and is unreachable, the other reads the rest of the
  // collection and is a stale view. This test is what stops a later reader
  // "fixing" the pair into consistency.
  it.effect("a stale collection is a code while a stale phase is an exclusion", () =>
    Effect.gen(function* () {
      const running = makeDelegation({
        phase: {
          _tag: "Running",
          childThreadId: CHILD_THREAD_ID,
          childTurnId: null,
          startedAt: NOW,
          progress: null,
        },
      });

      const openRetry = {
        type: "delegation.retry" as const,
        commandId: CommandId.make("command-retry-own-phase"),
        delegationId: running.delegationId,
        createdAt: LATER,
      };

      // A client CAN send this: the command is client-dispatchable and carries
      // only the id. The exclusion is that no shipped surface offers the button,
      // which is a different claim from "a client cannot dispatch it".
      expect(clientCanDispatch(openRetry)).toBe(true);

      const openError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([running]),
        command: openRetry,
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(openError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected the own-phase guard to refuse");
      }

      // Own phase: terminal once a client can see it, so no surface reaches it.
      expect(openError.refusal).toBeUndefined();
      expect(openError.exclusion?.kind).toBe("no-shipped-surface");

      const canceled = makeDelegation({
        delegationId: DelegationId.make("delegation-canceled-asymmetry"),
        phase: {
          _tag: "Canceled",
          childThreadId: null,
          childTurnId: null,
          startedAt: null,
          completedAt: LATER,
          canceledBy: "user",
        },
      });

      const successor = makeDelegation({
        delegationId: DelegationId.make("delegation-retry-of-canceled-asymmetry"),
        retryOfDelegationId: canceled.delegationId,
      });

      const supersededError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([canceled, successor]),
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry-rest-of-collection"),
          delegationId: canceled.delegationId,
          createdAt: LATER,
        },
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(supersededError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected the already-retried guard to refuse");
      }

      // Rest of the collection: another device added a sibling, so refresh.
      expect(supersededError.refusal).toBe("stale-view");
      expect(supersededError.exclusion).toBeUndefined();

      const active = [1, 2, 3].map((index) =>
        makeDelegation({ delegationId: DelegationId.make(`delegation-busy-${index}`) }),
      );

      const capError = yield* decideOrchestrationCommand({
        readModel: makeReadModel([canceled, ...active]),
        command: {
          type: "delegation.retry",
          commandId: CommandId.make("command-retry-cap-code"),
          delegationId: canceled.delegationId,
          createdAt: LATER,
        },
      }).pipe(Effect.flip);

      if (!Predicate.isTagged(capError, "OrchestrationCommandInvariantError")) {
        throw new Error("Expected the concurrency guard to refuse");
      }

      // Same reason-kind as the create-time cap, so it reuses that code rather
      // than minting a fourth for "this bot has too much in flight".
      expect(capError.refusal).toBe("delegation-limit-reached");
    }),
  );
});
