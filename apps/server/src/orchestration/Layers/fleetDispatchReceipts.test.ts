import {
  BotId,
  EventId,
  FLEET_DISPATCH_CLAIM_ACTIVITY,
  FLEET_DISPATCH_IDLE_ACTIVITY,
  FLEET_DISPATCH_TRIAGE_ACTIVITY,
  FleetRoleId,
  type FleetDispatchTriagePayload,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  ThreadId,
  WorkItemId,
} from "@isnadi/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { internalInvariantError } from "../Errors.ts";
import type { OrchestrationEngineShape } from "../Services/OrchestrationEngine.ts";
import {
  GROUP_ID,
  makeBot,
  makeGroupThread,
  makeReadModel,
} from "../test-support/GroupDeciderFixtures.ts";
import { LATER, NOW, botThread, workItem } from "../test-support/FleetDispatcherFixtures.ts";
import {
  groupChatThread,
  idleAlreadyNoted,
  noteDispatchClaim,
  noteDispatchIdle,
  noteDispatchTriage,
} from "./fleetDispatchReceipts.ts";

const BOT = makeBot({ id: BotId.make("bot-specialist"), groupId: GROUP_ID });

const ITEM = workItem({ id: "item-1" });

/** The group's own chat: filed in the space, owned by no bot. */
const groupChat = (
  input: {
    readonly id?: string;
    readonly updatedAt?: string;
    readonly activities?: OrchestrationThread["activities"];
    readonly archivedAt?: string | null;
    readonly deletedAt?: string | null;
  } = {},
): OrchestrationThread => ({
  ...makeGroupThread(),
  id: ThreadId.make(input.id ?? "thread-group"),
  updatedAt: input.updatedAt ?? NOW,
  archivedAt: input.archivedAt ?? null,
  deletedAt: input.deletedAt ?? null,
  activities: input.activities ?? [],
});

/** A fleet note already in the chat, as the projector would have written it. */
const fleetNote = (kind: string, createdAt: string): OrchestrationThread["activities"][number] => ({
  id: EventId.make(`note-${kind}-${createdAt}`),
  tone: "info",
  kind,
  summary: "an earlier note",
  payload: {},
  turnId: null,
  createdAt,
});

/**
 * An engine that records what it was asked to write. The receipts only ever
 * dispatch, so the rest of the shape is unreachable and says so.
 */
const recordingEngine = () => {
  const dispatched: OrchestrationCommand[] = [];

  const engine: OrchestrationEngineShape = {
    readEvents: () => Stream.die("unused"),
    readThreadEvents: () => Stream.die("unused"),
    getThreadReplayStats: () => Effect.die("unused"),
    dispatch: (command) =>
      Effect.sync(() => {
        dispatched.push(command);

        return { sequence: dispatched.length };
      }),
    get streamDomainEvents() {
      return Stream.die("unused") as Stream.Stream<OrchestrationEvent>;
    },
    subscribeDomainEvents: Effect.die("unused"),
    latestSequence: Effect.succeed(0),
  };

  return { engine, dispatched };
};

/** An engine that refuses every append, as the real one does on a lost command. */
const refusingEngine = (): OrchestrationEngineShape => ({
  ...recordingEngine().engine,
  dispatch: () =>
    Effect.fail(
      internalInvariantError({
        commandType: "thread.activity.append",
        detail: "The chat is gone.",
        reason:
          "Test fixture: the test refuses the append to prove a lost note does not unwind the hand-out.",
      }),
    ),
});

const modelWith = (...threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel =>
  makeReadModel({ bots: [BOT], threads });

const appendCommands = (dispatched: ReadonlyArray<OrchestrationCommand>) =>
  dispatched.flatMap((command) => (command.type === "thread.activity.append" ? [command] : []));

/** The single activity append a note wrote, narrowed for its fields. */
const onlyAppend = (dispatched: ReadonlyArray<OrchestrationCommand>) => {
  const [command] = appendCommands(dispatched);

  if (command?.type !== "thread.activity.append") throw new Error("expected one activity append");

  return command;
};

describe("fleet dispatch receipts", () => {
  describe("groupChatThread", () => {
    it("picks the newest chat the group owns, not a member's own", () => {
      const model = modelWith(
        groupChat({ id: "thread-group-old", updatedAt: NOW }),
        groupChat({ id: "thread-group-new", updatedAt: LATER }),
        botThread(BOT.id, "thread-bot-specialist"),
      );

      expect(groupChatThread(model, GROUP_ID)?.id).toBe("thread-group-new");
    });

    // A chat belongs to a bot or to a group, never both, so a member's chat filed
    // in the same space is not where the group reads.
    it("ignores a member's chat even when it is filed in the group's space", () => {
      const model = modelWith({
        ...botThread(BOT.id, "thread-bot-in-space"),
        groupId: GROUP_ID,
        updatedAt: LATER,
      });

      expect(groupChatThread(model, GROUP_ID)).toBeUndefined();
    });

    it("skips archived and deleted chats", () => {
      const model = modelWith(
        groupChat({ id: "thread-group-live", updatedAt: NOW }),
        groupChat({ id: "thread-group-archived", updatedAt: LATER, archivedAt: LATER }),
        groupChat({ id: "thread-group-deleted", updatedAt: LATER, deletedAt: LATER }),
      );

      expect(groupChatThread(model, GROUP_ID)?.id).toBe("thread-group-live");
    });

    it("is undefined when the group has no chat at all", () => {
      expect(groupChatThread(modelWith(botThread(BOT.id, "thread-bot")), GROUP_ID)).toBeUndefined();
    });
  });

  describe("idleAlreadyNoted", () => {
    it("is not noted when the chat has said nothing yet", () => {
      expect(idleAlreadyNoted(groupChat())).toBe(false);
    });

    it("is noted once the chat ends on an idle note", () => {
      expect(
        idleAlreadyNoted(groupChat({ activities: [fleetNote(FLEET_DISPATCH_IDLE_ACTIVITY, NOW)] })),
      ).toBe(true);
    });

    // Work was handed out since the last idle note, so the queue emptying again is news.
    it("is not noted when the last fleet note was a claim", () => {
      expect(
        idleAlreadyNoted(
          groupChat({
            activities: [
              fleetNote(FLEET_DISPATCH_IDLE_ACTIVITY, NOW),
              fleetNote(FLEET_DISPATCH_CLAIM_ACTIVITY, LATER),
            ],
          }),
        ),
      ).toBe(false);
    });

    it("reads by time, not by the order the activities were appended", () => {
      expect(
        idleAlreadyNoted(
          groupChat({
            activities: [
              fleetNote(FLEET_DISPATCH_IDLE_ACTIVITY, LATER),
              fleetNote(FLEET_DISPATCH_CLAIM_ACTIVITY, NOW),
            ],
          }),
        ),
      ).toBe(true);
    });
  });

  describe("noteDispatchClaim", () => {
    it.effect("appends the claim to the group's chat with the bot and the item", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        yield* noteDispatchClaim(engine, {
          readModel: modelWith(groupChat(), botThread(BOT.id, "thread-bot-specialist")),
          groupId: GROUP_ID,
          bot: BOT,
          item: ITEM,
          createdAt: NOW,
        });

        const command = onlyAppend(dispatched);

        expect(command.threadId).toBe("thread-group");
        expect(command.activity.kind).toBe(FLEET_DISPATCH_CLAIM_ACTIVITY);
        expect(command.activity.payload).toEqual({
          botId: BOT.id,
          botName: BOT.name,
          workItemId: ITEM.id,
          itemTitle: ITEM.title,
        });
        expect(command.activity.summary).toBe(
          `${BOT.name} was idle, so the board gave it "${ITEM.title}".`,
        );
      }),
    );

    it.effect("writes nothing when the group has no chat, rather than inventing one", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        yield* noteDispatchClaim(engine, {
          readModel: modelWith(botThread(BOT.id, "thread-bot-specialist")),
          groupId: GROUP_ID,
          bot: BOT,
          item: ITEM,
          createdAt: NOW,
        });

        expect(dispatched).toEqual([]);
      }),
    );

    // A refused append is a courtesy row lost, not a hand-out to unwind.
    it.effect("keeps the hand-out standing when the engine refuses the note", () =>
      Effect.gen(function* () {
        yield* noteDispatchClaim(refusingEngine(), {
          readModel: modelWith(groupChat()),
          groupId: GROUP_ID,
          bot: BOT,
          item: ITEM,
          createdAt: NOW,
        });
      }),
    );
  });

  describe("noteDispatchIdle", () => {
    it.effect("appends the idle note to the group's chat", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        yield* noteDispatchIdle(engine, {
          readModel: modelWith(groupChat()),
          groupId: GROUP_ID,
          createdAt: NOW,
        });

        const command = onlyAppend(dispatched);

        expect(command.threadId).toBe("thread-group");
        expect(command.activity.kind).toBe(FLEET_DISPATCH_IDLE_ACTIVITY);
        expect(command.activity.summary).toBe("Everyone is idle and the board is empty.");
        expect(command.activity.payload).toEqual({});
      }),
    );

    it.effect("says it once, not again on the next pass", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        const model = modelWith(
          groupChat({ activities: [fleetNote(FLEET_DISPATCH_IDLE_ACTIVITY, NOW)] }),
        );

        yield* noteDispatchIdle(engine, { readModel: model, groupId: GROUP_ID, createdAt: LATER });

        expect(dispatched).toEqual([]);
      }),
    );

    it.effect("says it again after work was handed out", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        const model = modelWith(
          groupChat({ activities: [fleetNote(FLEET_DISPATCH_CLAIM_ACTIVITY, NOW)] }),
        );

        yield* noteDispatchIdle(engine, { readModel: model, groupId: GROUP_ID, createdAt: LATER });

        expect(appendCommands(dispatched)).toHaveLength(1);
      }),
    );

    it.effect("writes nothing when the group has no chat", () =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        yield* noteDispatchIdle(engine, {
          readModel: modelWith(botThread(BOT.id, "thread-bot-specialist")),
          groupId: GROUP_ID,
          createdAt: NOW,
        });

        expect(dispatched).toEqual([]);
      }),
    );
  });

  describe("noteDispatchTriage", () => {
    const ARCHITECT = FleetRoleId.make("architect");

    const triageNote = (
      payload: FleetDispatchTriagePayload,
    ): OrchestrationThread["activities"][number] => ({
      id: EventId.make(`triage-${payload.workItemId}`),
      tone: "info",
      kind: FLEET_DISPATCH_TRIAGE_ACTIVITY,
      summary: "an earlier triage note",
      payload,
      turnId: null,
      createdAt: NOW,
    });

    const triagePayload = (workItemId: string): FleetDispatchTriagePayload => ({
      workItemId: WorkItemId.make(workItemId),
      itemTitle: ITEM.title,
      role: ARCHITECT,
    });

    /** Notes ITEM's wait on `readModel` and hands back what the engine was asked to append. */
    const noteOn = (readModel: OrchestrationReadModel, createdAt: string = NOW) =>
      Effect.gen(function* () {
        const { engine, dispatched } = recordingEngine();

        yield* noteDispatchTriage(engine, {
          readModel,
          groupId: GROUP_ID,
          item: ITEM,
          role: ARCHITECT,
          createdAt,
        });

        return dispatched;
      });

    it.effect("appends the row that names the role nobody holds", () =>
      Effect.gen(function* () {
        const command = onlyAppend(yield* noteOn(modelWith(groupChat())));

        expect(command.threadId).toBe("thread-group");
        expect(command.activity.kind).toBe(FLEET_DISPATCH_TRIAGE_ACTIVITY);
        expect(command.activity.payload).toEqual(triagePayload(ITEM.id));
        expect(command.activity.summary).toBe(
          `"${ITEM.title}" goes to the architect role, and no one here holds it.`,
        );
      }),
    );

    it.effect("says it once per item, and again for the next item on the same role", () =>
      Effect.gen(function* () {
        // The receipt id is the item, so a note already on the thread is what makes it quiet.
        const said = (noted: string) =>
          noteOn(modelWith(groupChat({ activities: [triageNote(triagePayload(noted))] })), LATER);

        expect(yield* said(ITEM.id)).toEqual([]);
        expect(appendCommands(yield* said("item-other"))).toHaveLength(1);
      }),
    );

    it.effect("writes nothing when the group has no chat", () =>
      Effect.gen(function* () {
        const dispatched = yield* noteOn(modelWith(botThread(BOT.id, "thread-bot-specialist")));

        expect(dispatched).toEqual([]);
      }),
    );
  });
});
