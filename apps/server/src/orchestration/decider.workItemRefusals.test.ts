import {
  BotId,
  CommandId,
  WorkItemId,
  type ClientWorkItemCommand,
  type OrchestrationCommand,
  type WorkItem,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type * as PlatformError from "effect/PlatformError";
import * as Predicate from "effect/Predicate";
import { decideOrchestrationCommand } from "./decider.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  OTHER_SPECIALIST_ID,
  PERSON_ID,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "./test-support/GroupDeciderFixtures.ts";

/**
 * TASK-336: every work-item refusal a person's board can reach carries a code,
 * so the client picks its own sentence instead of rendering the invariant prose
 * with its ids. The prose stays on `detail` as the log line and the fallback for
 * an older client, so each case below asserts the code and, where it matters,
 * that the prose still names the transition.
 *
 * The six sites with no code are asserted too: four bot guards and two claim
 * guards. A code appearing there would be copy nobody can ever see, and a code
 * disappearing from a person path is the silent leak this card exists to end.
 */
const ITEM_ID = WorkItemId.make("item-1");

const OPEN_LIMIT = 200;

const makeItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: ITEM_ID,
  groupId: GROUP_ID,
  title: "Fix the thing",
  brief: "It is broken.",
  kind: "task",
  state: "queued",
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const makeModel = (items: ReadonlyArray<WorkItem>) => ({
  ...makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: SPECIALIST_ID, groupId: GROUP_ID }),
      makeBot({ id: OTHER_SPECIALIST_ID }),
    ],
    groups: [makeGroup()],
  }),
  workItems: items,
});

/** A bot acts only through the server-built wrapper, which stamps the bot id. */
const botCmd = (actorBotId: BotId, command: ClientWorkItemCommand): OrchestrationCommand => ({
  type: "work-item.bot-act",
  commandId: CommandId.make("cmd-work-item.bot-act"),
  actorBotId,
  command,
  createdAt: NOW,
});

it.layer(NodeServices.layer)("work-item refusals", (it) => {
  const decideFailure = (
    command: OrchestrationCommand,
    items: ReadonlyArray<WorkItem>,
    actor?: { readonly personId: typeof PERSON_ID; readonly canManageGroups: boolean },
  ) =>
    decideOrchestrationCommand({
      command,
      readModel: makeModel(items),
      ...(actor !== undefined ? { actor } : {}),
    }).pipe(Effect.flip);

  const refusalOf = (error: OrchestrationCommandInvariantError | PlatformError.PlatformError) => {
    if (!Predicate.isTagged(error, "OrchestrationCommandInvariantError")) {
      throw new Error("Expected a command invariant error");
    }

    return { refusal: error.refusal, detail: error.detail };
  };

  const person = { personId: PERSON_ID, canManageGroups: false };

  // ------------------------------------------------------- stale-view (2)

  it.effect("codes a close of a card another device already closed", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        {
          type: "work-item.close",
          commandId: CommandId.make("cmd-close-again"),
          workItemId: ITEM_ID,
          resolution: "done",
        },
        [makeItem({ state: "done", doneAt: NOW })],
        person,
      );

      const { refusal, detail } = refusalOf(error);

      // The card moved and the only thing left to do is look again, which is
      // what the shared sentence asks for.
      expect(refusal).toBe("stale-view");
      expect(detail).toContain("already done");
    }),
  );

  it.effect("codes an update of a card that was deleted elsewhere", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        {
          type: "work-item.update",
          commandId: CommandId.make("cmd-update-gone"),
          workItemId: ITEM_ID,
          title: "New title",
        },
        [],
        person,
      );

      const { refusal, detail } = refusalOf(error);

      expect(refusal).toBe("stale-view");
      expect(detail).toContain("does not exist");
    }),
  );

  // ---------------------------------------------------- already-exists (1)

  it.effect("codes a create for an id the environment already holds", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        botCmd(BOSS_ID, {
          type: "work-item.create",
          commandId: CommandId.make("cmd-create-again"),
          workItemId: ITEM_ID,
          groupId: GROUP_ID,
          title: "Fix the thing",
          brief: "It is broken.",
          kind: "task",
        }),
        [makeItem()],
      );

      expect(refusalOf(error).refusal).toBe("already-exists");
    }),
  );

  // ----------------------------------------------- work-item-limit-reached (2)

  const atTheLimit = () =>
    Array.from({ length: OPEN_LIMIT }, (_, index) =>
      makeItem({ id: WorkItemId.make(`open-${index}`) }),
    );

  it.effect("codes a create once the space holds as many open cards as it may", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        {
          type: "work-item.create",
          commandId: CommandId.make("cmd-create-over-limit"),
          workItemId: ITEM_ID,
          groupId: GROUP_ID,
          title: "One more",
          brief: "Too many.",
          kind: "task",
        },
        atTheLimit(),
      );

      const { refusal, detail } = refusalOf(error);

      // The count stays on the log line; the sentence carries no number.
      expect(refusal).toBe("work-item-limit-reached");
      expect(detail).toContain(`${OPEN_LIMIT} open items`);
    }),
  );

  it.effect("codes a reopen once the space holds as many open cards as it may", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        {
          type: "work-item.reopen",
          commandId: CommandId.make("cmd-reopen-over-limit"),
          workItemId: ITEM_ID,
        },
        [...atTheLimit(), makeItem({ state: "closed", closedAt: NOW })],
        person,
      );

      expect(refusalOf(error).refusal).toBe("work-item-limit-reached");
    }),
  );

  // ---------------------------------------------- work-item-state-invalid (6)

  it.effect("codes every state rule the card's own state refuses", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string;
        readonly command: OrchestrationCommand;
        readonly item: WorkItem;
        readonly detail: string;
      }> = [
        {
          label: "block a done card",
          command: {
            type: "work-item.block",
            commandId: CommandId.make("cmd-block-done"),
            workItemId: ITEM_ID,
            blockedOn: { by: "user", note: "Waiting" },
          },
          item: makeItem({ state: "done", doneAt: NOW }),
          detail: "cannot be blocked",
        },
        {
          label: "update a done card",
          command: {
            type: "work-item.update",
            commandId: CommandId.make("cmd-update-done"),
            workItemId: ITEM_ID,
            title: "New title",
          },
          item: makeItem({ state: "done", doneAt: NOW }),
          detail: "reopened first",
        },
        {
          label: "reopen an open card",
          command: {
            type: "work-item.reopen",
            commandId: CommandId.make("cmd-reopen-open"),
            workItemId: ITEM_ID,
          },
          item: makeItem(),
          detail: "done or closed",
        },
        {
          label: "unblock a card that is not blocked",
          command: {
            type: "work-item.unblock",
            commandId: CommandId.make("cmd-unblock-open"),
            workItemId: ITEM_ID,
          },
          item: makeItem(),
          detail: "Only a blocked item",
        },
        {
          label: "move a queued card to a progress state",
          command: {
            type: "work-item.update",
            commandId: CommandId.make("cmd-move-queued"),
            workItemId: ITEM_ID,
            state: "review",
          },
          item: makeItem(),
          detail: "cannot move to",
        },
      ];

      for (const { label, command, item, detail } of cases) {
        const { refusal, detail: prose } = refusalOf(yield* decideFailure(command, [item], person));

        // One code, not six: the remedy is the same at every site — pick an
        // action that fits — so a client needs one sentence, not five.
        expect(refusal, label).toBe("work-item-state-invalid");
        expect(prose, label).toContain(detail);
      }
    }),
  );

  // ---------------------------------------------- bot-not-a-group-member (1)

  it.effect("codes an owner the group no longer holds", () =>
    Effect.gen(function* () {
      const error = yield* decideFailure(
        {
          type: "work-item.assign",
          commandId: CommandId.make("cmd-assign-stranger"),
          workItemId: ITEM_ID,
          ownerBotId: OTHER_SPECIALIST_ID,
        },
        [makeItem()],
        person,
      );

      // The subject is the bot being assigned, not the actor, so the remedy is
      // the refresh this code already names.
      expect(refusalOf(error).refusal).toBe("bot-not-a-group-member");
    }),
  );

  // -------------------------------------------------- no code (6 exclusions)

  it.effect("leaves the two claim guards uncoded: the contract cannot carry them", () =>
    Effect.gen(function* () {
      const claim = (suffix: string): OrchestrationCommand => ({
        type: "work-item.claim",
        commandId: CommandId.make(`cmd-claim-${suffix}`),
        botId: BOSS_ID,
        workItemId: ITEM_ID,
        createdAt: NOW,
      });

      for (const [label, item] of [
        ["a finished card", makeItem({ state: "done", doneAt: NOW })],
        ["a card already taken", makeItem({ state: "assigned", ownerBotId: SPECIALIST_ID })],
      ] as const) {
        const { refusal } = refusalOf(yield* decideFailure(claim("guard"), [item]));

        // `work-item.claim` is not in `ClientWorkItemCommand`, so no surface can
        // send it, and the dispatcher swallows this invariant into a `false`.
        expect(refusal, label).toBeUndefined();
      }
    }),
  );

  it.effect("leaves the four bot guards uncoded: only the server-built wrapper reaches them", () =>
    Effect.gen(function* () {
      const cases: ReadonlyArray<{
        readonly label: string;
        readonly command: OrchestrationCommand;
        readonly item: WorkItem;
      }> = [
        {
          label: "a bot that is not in the group",
          command: botCmd(OTHER_SPECIALIST_ID, {
            type: "work-item.update",
            commandId: CommandId.make("cmd-bot-stranger"),
            workItemId: ITEM_ID,
            title: "New title",
          }),
          item: makeItem(),
        },
        {
          label: "a member bot running a boss-only command",
          command: botCmd(SPECIALIST_ID, {
            type: "work-item.assign",
            commandId: CommandId.make("cmd-bot-assign"),
            workItemId: ITEM_ID,
            ownerBotId: SPECIALIST_ID,
          }),
          item: makeItem(),
        },
        {
          label: "a member bot changing a card it does not own",
          command: botCmd(SPECIALIST_ID, {
            type: "work-item.update",
            commandId: CommandId.make("cmd-bot-update"),
            workItemId: ITEM_ID,
            title: "New title",
          }),
          item: makeItem({ state: "assigned", ownerBotId: BOSS_ID }),
        },
      ];

      for (const { label, command, item } of cases) {
        const { refusal } = refusalOf(yield* decideFailure(command, [item]));

        // A bot actor arrives only through `BotWorkItemCommand`, built by the
        // server after resolving the bot from its own session.
        expect(refusal, label).toBeUndefined();
      }
    }),
  );
});
