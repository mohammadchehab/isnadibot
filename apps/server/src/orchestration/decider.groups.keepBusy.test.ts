import {
  BotId,
  CommandId,
  GroupCreatedPayload,
  GroupId,
  type OrchestrationEvent,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  SPECIALIST_ID,
  makeBot,
  makeGroup,
  makeReadModel,
} from "./test-support/GroupDeciderFixtures.ts";

const setKeepBusy = (keepBusy: boolean, groupId: typeof GROUP_ID = GROUP_ID) => ({
  type: "group.keep-busy.set" as const,
  commandId: CommandId.make("cmd-keep-busy"),
  groupId,
  keepBusy,
});

const createGroup = (input: { readonly keepBusy?: boolean; readonly hopBudget?: number }) =>
  decideOrchestrationCommand({
    command: {
      type: "group.create",
      commandId: CommandId.make("cmd-group-create"),
      groupId: GROUP_ID,
      name: "Product",
      bossBotId: BOSS_ID,
      specialistBotIds: [SPECIALIST_ID],
      createdAt: NOW,
      ...(input.keepBusy === undefined ? {} : { keepBusy: input.keepBusy }),
      ...(input.hopBudget === undefined ? {} : { hopBudget: input.hopBudget }),
    },
    readModel: makeReadModel({
      bots: [makeBot({ id: BOSS_ID }), makeBot({ id: SPECIALIST_ID })],
    }),
  }).pipe(Effect.map((result) => (Array.isArray(result) ? result[0] : result)));

it.layer(NodeServices.layer)("group keep busy decider", (it) => {
  it.effect("turns keep busy on, and the projection keeps it", () =>
    Effect.gen(function* () {
      const model = makeReadModel({ groups: [makeGroup()] });

      const result = yield* decideOrchestrationCommand({
        command: setKeepBusy(true),
        readModel: model,
      });
      const event = Array.isArray(result) ? result[0] : result;

      if (event?.type !== "group.keep-busy-set") throw new Error("Expected keep busy event");
      expect(event.payload).toMatchObject({ groupId: GROUP_ID, keepBusy: true });

      const projected = yield* projectEvent(model, { ...event, sequence: 1 } as OrchestrationEvent);

      expect(projected.groups[0]?.keepBusy).toBe(true);
    }),
  );

  it.effect("turns keep busy back off", () =>
    Effect.gen(function* () {
      const model = makeReadModel({ groups: [{ ...makeGroup(), keepBusy: true }] });

      const result = yield* decideOrchestrationCommand({
        command: setKeepBusy(false),
        readModel: model,
      });

      const event = Array.isArray(result) ? result[0] : result;

      if (event?.type !== "group.keep-busy-set") throw new Error("Expected keep busy event");

      const projected = yield* projectEvent(model, { ...event, sequence: 1 } as OrchestrationEvent);

      expect(projected.groups[0]?.keepBusy).toBe(false);
    }),
  );

  it.effect("refuses a group that does not exist", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: setKeepBusy(true, GroupId.make("group-missing")),
        readModel: makeReadModel({ groups: [makeGroup()] }),
      }).pipe(Effect.flip);

      expect(String(error)).toContain("group-missing");
    }),
  );

  it.effect("a group created with keep busy carries it through create and projection", () =>
    Effect.gen(function* () {
      const event = yield* createGroup({ keepBusy: true });

      if (event?.type !== "group.created") throw new Error("Expected group.created");
      expect(event.payload.keepBusy).toBe(true);

      const readModel = yield* projectEvent(makeReadModel({}), {
        ...event,
        sequence: 1,
      } as OrchestrationEvent);

      expect(readModel.groups[0]?.keepBusy).toBe(true);
    }),
  );

  it.effect("a group without keep busy behaves exactly as today", () =>
    Effect.gen(function* () {
      const event = yield* createGroup({ hopBudget: 4 });

      if (event?.type !== "group.created") throw new Error("Expected group.created");
      expect(event.payload.keepBusy).toBeUndefined();
      expect(event.payload.hopBudget).toBe(4);

      const readModel = yield* projectEvent(makeReadModel({}), {
        ...event,
        sequence: 1,
      } as OrchestrationEvent);

      expect(readModel.groups[0]?.keepBusy).toBe(false);
    }),
  );

  it.effect("a group.created event stored before the flag existed decodes as off", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownEffect(GroupCreatedPayload);

      const payload = yield* decode({
        groupId: GROUP_ID,
        name: "Product",
        bossBotId: BOSS_ID,
        members: [{ kind: "bot", botId: BotId.make("bot-boss"), role: "boss" }],
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(payload.keepBusy).toBe(false);
    }),
  );
});
