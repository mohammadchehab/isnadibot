import { it } from "@effect/vitest";
import {
  type BotId,
  type GroupId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
  type WorkItem,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import { describe, expect } from "vite-plus/test";

import type { OrchestrationRuntimeReceipt } from "../Services/RuntimeReceiptBus.ts";
import { GROUP_ID, SPECIALIST_ID, makeGroupThread } from "../test-support/GroupDeciderFixtures.ts";
import {
  type Ac3Thread,
  LATER,
  NOW,
  harness,
  idleTeamModel,
  run,
  workItem,
} from "../test-support/FleetDispatcherFixtures.ts";

describe("FleetDispatcherReactor idle rule (AC3)", () => {
  const runningTurn = (botId: BotId) => ({
    turnId: TurnId.make("turn-1"),
    state: "running" as const,
    requestedAt: NOW,
    startedAt: NOW,
    completedAt: null,
    assistantMessageId: null,
    respondingBotId: botId,
  });

  /** A bot's own chat, as the shell serves it: a thread plus the pending flags AC3 reads. */
  const botShell = (input: {
    readonly botId: BotId | null;
    readonly id: string;
    readonly groupId?: GroupId | null;
    readonly respondingBotId?: BotId | null;
    readonly hasPendingApprovals?: boolean;
    readonly hasPendingUserInput?: boolean;
    readonly running?: BotId | null;
  }): Ac3Thread => ({
    ...makeGroupThread(),
    id: ThreadId.make(input.id),
    botId: input.botId,
    groupId: input.groupId ?? null,
    respondingBotId: input.respondingBotId ?? null,
    session: null,
    latestTurn:
      input.running === undefined || input.running === null ? null : runningTurn(input.running),
    hasPendingApprovals: input.hasPendingApprovals ?? false,
    hasPendingUserInput: input.hasPendingUserInput ?? false,
  });

  const modelWith = (
    threads: ReadonlyArray<Ac3Thread>,
    items: ReadonlyArray<WorkItem>,
  ): OrchestrationReadModel => ({
    ...idleTeamModel(items),
    threads,
  });

  const expectSkipped = (
    h: Effect.Success<typeof harness>,
    receipts: Effect.Effect<ReadonlyArray<OrchestrationRuntimeReceipt>>,
  ) =>
    Effect.gen(function* () {
      expect(h.dispatched).toEqual([]);
      expect(yield* receipts).toMatchObject([
        { type: "fleet.dispatch.decided", kind: "skipped", reason: "no-idle-member" },
      ]);
    });

  it.effect("does not wake a bot that is waiting on the user's answer", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({
              botId: SPECIALIST_ID,
              id: "thread-bot-specialist",
              hasPendingUserInput: true,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not wake a bot that has an approval pending", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({
              botId: SPECIALIST_ID,
              id: "thread-bot-specialist",
              hasPendingApprovals: true,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not wake a bot that holds a blocked item", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      yield* Ref.set(
        h.model,
        modelWith(
          [botShell({ botId: SPECIALIST_ID, id: "thread-bot-specialist" })],
          [
            workItem({ id: "item-held", state: "blocked", ownerBotId: SPECIALIST_ID }),
            workItem({ id: "item-1", createdAt: LATER }),
          ],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("does not start a turn inside a group responder queue that is running", () =>
    Effect.gen(function* () {
      const h = yield* harness;

      // The specialist is answering in the group chat while its own chat sits idle, so only the
      // shared rule — which follows who a chat's responder is — can see it is busy.
      yield* Ref.set(
        h.model,
        modelWith(
          [
            botShell({ botId: SPECIALIST_ID, id: "thread-bot-specialist" }),
            botShell({
              botId: null,
              id: "thread-group",
              groupId: GROUP_ID,
              respondingBotId: SPECIALIST_ID,
              running: SPECIALIST_ID,
            }),
          ],
          [workItem({ id: "item-1" })],
        ),
      );

      yield* run(h, ({ reactor, receipts }) =>
        Effect.gen(function* () {
          yield* reactor.drain;

          yield* expectSkipped(h, receipts);
        }),
      );
    }).pipe(Effect.scoped),
  );
});
