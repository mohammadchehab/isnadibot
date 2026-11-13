import {
  EnvironmentId,
  FLEET_TEMPLATES,
  FleetRoleId,
  GroupHopBudget,
  ORCHESTRATION_WS_METHODS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ClientOrchestrationCommand,
  type FleetTemplate,
  type ServerProvider,
  type ServerProviderModel,
} from "@isnadi/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { RpcClientError } from "effect/unstable/rpc";

import { testRpcClient } from "../test-support/services.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";

import {
  HireFleetError,
  createHireDraft,
  draftBlockers,
  hireFleet,
  recordHireFailure,
  setBoss,
  setHopBudget,
  setMemberModel,
  setMemberReasoning,
  type HireDraft,
} from "./hireFleet.ts";

const template = FLEET_TEMPLATES.find(
  (candidate) => candidate.id === "recruiting",
) as FleetTemplate;

/** The command builders ask for ids and remains from Crypto, so each hire effect provides one. */
const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

/** A reasoning picker on `slug`, with its levels and the one it defaults to. */
function reasoningModel(
  slug: string,
  levels: ReadonlyArray<string>,
  isDefault = false,
): ServerProviderModel {
  return {
    slug,
    name: slug,
    isCustom: false,
    isDefault,
    capabilities: {
      optionDescriptors: [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          options: levels.map((level) => ({
            id: level,
            label: level,
            isDefault: level === levels[0],
          })),
        },
      ],
    },
  };
}

function plainModel(slug: string, isDefault = false): ServerProviderModel {
  return { slug, name: slug, isCustom: false, isDefault, capabilities: null };
}

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude-1"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-06T00:00:00.000Z",
    models: [
      reasoningModel("claude-sonnet-5-5", ["low", "medium", "high"], true),
      reasoningModel("claude-opus-5-5", ["low", "medium", "high"]),
      // No "medium": a member that moves here has its level adjusted.
      reasoningModel("claude-haiku-5-5", ["low", "high"]),
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const PROVIDERS: ReadonlyArray<ServerProvider> = [
  provider(),
  provider({
    instanceId: ProviderInstanceId.make("codex-1"),
    driver: ProviderDriverKind.make("codex"),
    models: [plainModel("gpt-6.1-sol", true)],
  }),
  provider({
    instanceId: ProviderInstanceId.make("grok-1"),
    driver: ProviderDriverKind.make("grok"),
    models: [plainModel("grok-5", true)],
  }),
];

interface DispatchLog {
  readonly commands: ClientOrchestrationCommand[];
  /** The 1-based dispatch that fails, as a dropped socket would. */
  readonly failAt?: number;
}

const makeSupervisor = Effect.fn("TestHireFleet.makeSupervisor")(function* (log: DispatchLog) {
  const client = testRpcClient({
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.gen(function* () {
        log.commands.push(command);

        if (log.failAt === log.commands.length) {
          return yield* new RpcClientError.RpcClientError({
            reason: new RpcClientError.RpcClientDefect({
              message: "socket closed",
              cause: new Error("socket closed"),
            }),
          });
        }

        return { sequence: log.commands.length };
      }),
  });

  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };

  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
    retryIfDesired: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

/** Mints ids in call order, so a test can name the command ids it expects. */
function makeIdFactory(): () => string {
  let minted = 0;

  return () => {
    minted += 1;

    return `id-${minted}`;
  };
}

function draft(providers: ReadonlyArray<ServerProvider> = PROVIDERS): HireDraft {
  return createHireDraft({
    template,
    providers,
    makeId: makeIdFactory(),
    createdAt: "2026-06-06T00:00:00.000Z",
  });
}

const botCreateIds = (log: DispatchLog) =>
  log.commands
    .filter((command: ClientOrchestrationCommand) => command.type === "bot.create")
    .map((command) => command.commandId);

/** Why a hire stopped, for the screen that keeps the draft and lets the user retry. */
function hireFailure(hire: HireDraft, log: DispatchLog) {
  return Effect.gen(function* () {
    const supervisor = yield* makeSupervisor(log);

    return yield* Effect.flip(
      hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      ),
    );
  }).pipe(Effect.provide(TEST_CRYPTO_LAYER));
}

/** The member at `index`; the recruiting template's squad is long enough for every test here. */
function memberAt(hire: HireDraft, index: number) {
  const member = hire.members[index];

  expect(member).toBeDefined();

  return member!;
}

describe("createHireDraft", () => {
  it("seeds every member boss first, each with its own ids", () => {
    const hire = draft();

    expect(hire.members.map((member) => member.roleId)).toEqual([
      template.bossRoleId,
      ...template.roleIds.filter((roleId) => roleId !== template.bossRoleId),
    ]);
    expect(new Set(hire.members.map((member) => member.botId)).size).toBe(hire.members.length);
    expect(new Set(hire.members.map((member) => member.createCommandId)).size).toBe(
      hire.members.length,
    );
    expect(hire.members.every((member) => member.engine !== null)).toBe(true);
    expect(hire.keepBusy).toBe(true);
  });
});

describe("hireFleet", () => {
  it.effect("creates one bot per member in screen order, then the group", () =>
    Effect.gen(function* () {
      const hire = draft();
      const log: DispatchLog = { commands: [] };

      const result = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
      );

      expect(log.commands.map((command: ClientOrchestrationCommand) => command.type)).toEqual([
        "bot.create",
        "bot.create",
        "bot.create",
        "bot.create",
        "group.create",
      ]);
      expect(botCreateIds(log)).toEqual(hire.members.map((member) => member.createCommandId));
      expect(result.botIds).toEqual(hire.members.map((member) => member.botId));
      expect(log.commands.at(-1)).toMatchObject({
        type: "group.create",
        commandId: hire.groupCommandId,
        groupId: hire.groupId,
        name: template.name,
        bossBotId: hire.members[0]?.botId,
        specialistBotIds: hire.members.slice(1).map((member) => member.botId),
        fleetTemplateId: template.id,
        keepBusy: true,
        hopBudget: GroupHopBudget.make(6),
        createdAt: hire.createdAt,
      });
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("resends the same command ids after a member fails, and creates one group", () =>
    Effect.gen(function* () {
      const hire = draft();
      const failed: DispatchLog = { commands: [], failAt: 3 };

      const exit = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(failed),
        ),
        Effect.exit,
      );

      expect(exit._tag).toBe("Failure");

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      expect(botCreateIds(retried)).toEqual(hire.members.map((member) => member.createCommandId));
      expect(botCreateIds(failed)).toEqual(botCreateIds(retried).slice(0, 3));
      expect(
        retried.commands.filter(
          (command: ClientOrchestrationCommand) => command.type === "group.create",
        ),
      ).toHaveLength(1);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("creates nothing when a member has no provider", () =>
    Effect.gen(function* () {
      const hire = draft([]);
      const log: DispatchLog = { commands: [] };

      const error = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
        Effect.catchTag("HireFleetError", (failure) => Effect.succeed(failure)),
      );

      expect(error).toBeInstanceOf(HireFleetError);
      expect(error).toMatchObject({ step: "blocked" });
      expect(log.commands).toEqual([]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("creates the boss chosen on screen with the budget stepped there", () =>
    Effect.gen(function* () {
      const bossed = setHopBudget(
        setBoss(draft(), FleetRoleId.make("coach")),
        GroupHopBudget.make(3),
      );

      const log: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: bossed, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
      );

      expect(log.commands.at(-1)).toMatchObject({
        bossBotId: bossed.members.find((member) => member.roleId === "coach")?.botId,
        hopBudget: GroupHopBudget.make(3),
      });
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});

describe("recordHireFailure", () => {
  it.effect("resends a reached member whose engine was edited, so the edit is not dropped", () =>
    Effect.gen(function* () {
      const hire = draft();
      // The third create fails, so the first two members are stored as they were sent.
      const failure = yield* hireFailure(hire, { commands: [], failAt: 3 });
      const reached = memberAt(hire, 0);

      const edited = setMemberModel(
        recordHireFailure(hire, failure),
        reached.roleId,
        { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-opus-5-5" },
        PROVIDERS,
      );

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: edited, makeId: () => "fresh-command-id" }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      expect(botCreateIds(retried)[0]).toBe("fresh-command-id");
      expect(retried.commands[0]).toMatchObject({ engine: { model: "claude-opus-5-5" } });
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("keeps the command id of a member the failed attempt never reached", () =>
    Effect.gen(function* () {
      const hire = draft();
      const failure = yield* hireFailure(hire, { commands: [], failAt: 3 });
      const unreached = memberAt(hire, hire.members.length - 1);

      const edited = setMemberModel(
        recordHireFailure(hire, failure),
        unreached.roleId,
        { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-opus-5-5" },
        PROVIDERS,
      );

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: edited, makeId: () => "fresh-command-id" }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      // Nothing was stored for this member, so its own id still describes its create.
      expect(botCreateIds(retried).at(-1)).toBe(unreached.createCommandId);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("leaves the draft alone when the hire was blocked before sending anything", () =>
    Effect.gen(function* () {
      // No providers: the draft blocks, so no create ever reached the server.
      const hire = draft([]);
      const failure = yield* hireFailure(hire, { commands: [] });

      expect(failure.step).toBe("blocked");
      expect(recordHireFailure(hire, failure)).toBe(hire);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});

describe("setMemberModel", () => {
  it("keeps the reasoning level when the new model offers it", () => {
    const changed = setMemberModel(
      draft(),
      FleetRoleId.make("tailor"),
      { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-opus-5-5" },
      PROVIDERS,
    );

    const tailor = changed.members.find((member) => member.roleId === "tailor");

    expect(tailor?.engine).toMatchObject({ model: "claude-opus-5-5" });
    expect(tailor?.notice).toBeNull();
  });

  it("falls back to the model's own default and says so when it has no such level", () => {
    const changed = setMemberModel(
      draft(),
      FleetRoleId.make("tailor"),
      { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-haiku-5-5" },
      PROVIDERS,
    );

    const tailor = changed.members.find((member) => member.roleId === "tailor");

    expect(tailor?.engine).toMatchObject({
      model: "claude-haiku-5-5",
      options: [{ id: "reasoningEffort", value: "low" }],
    });
    expect(tailor?.notice).toBe("reasoning-adjusted");
  });

  it("keeps a pick the server no longer offers, marks it, and blocks the hire", () => {
    const changed = setMemberModel(
      draft(),
      FleetRoleId.make("tailor"),
      { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-retired" },
      PROVIDERS,
    );

    const tailor = changed.members.find((member) => member.roleId === "tailor");

    expect(tailor?.engine).toMatchObject({ model: "claude-retired" });
    expect(tailor?.notice).toBe("model-unavailable");
    expect(draftBlockers(changed)).toContainEqual({
      kind: "no-provider",
      roleId: FleetRoleId.make("tailor"),
    });
  });

  it("marks a pick whose provider is gone too, so the picker stays the way out", () => {
    const changed = setMemberModel(
      draft(),
      FleetRoleId.make("tailor"),
      { instanceId: ProviderInstanceId.make("claude-gone"), model: "claude-opus-5-5" },
      PROVIDERS,
    );

    const tailor = changed.members.find((member) => member.roleId === "tailor");

    expect(tailor?.engine).toMatchObject({ provider: "claude-gone" });
    expect(tailor?.notice).toBe("model-unavailable");
  });
});

describe("setBoss", () => {
  it("puts the new boss first, so the plan's boss-first order stays true", () => {
    const hire = draft();
    const second = hire.members[1];

    expect(second).toBeDefined();

    if (second === undefined) return;

    const changed = setBoss(hire, second.roleId);

    expect(changed.bossRoleId).toBe(second.roleId);
    expect(changed.members[0]?.roleId).toBe(second.roleId);
    expect(changed.members.filter((member) => member.isBoss)).toHaveLength(1);
  });

  it("leaves the draft alone when the role is not in the squad", () => {
    const hire = draft();

    const changed = setBoss(hire, FleetRoleId.make("not-a-role"));

    expect(changed).toBe(hire);
  });
});

describe("setMemberReasoning", () => {
  it("saves the picked level and clears the notice", () => {
    const adjusted = setMemberModel(
      draft(),
      FleetRoleId.make("tailor"),
      { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-haiku-5-5" },
      PROVIDERS,
    );

    const picked = setMemberReasoning(adjusted, FleetRoleId.make("tailor"), [
      { id: "reasoningEffort", value: "high" },
    ]);

    const tailor = picked.members.find((member) => member.roleId === "tailor");

    expect(tailor?.engine).toMatchObject({ options: [{ id: "reasoningEffort", value: "high" }] });
    expect(tailor?.notice).toBeNull();
  });
});

describe("a draft's ids", () => {
  it("survive every edit, so a retry finishes the squad it started", () => {
    const hire = draft();

    const edited = setBoss(setHopBudget(hire, GroupHopBudget.make(2)), FleetRoleId.make("scout"));

    // The boss edit reorders the members so the boss leads, so ids are compared
    // by role: each role keeps the bot and command ids it was minted with.
    const idsByRole = (draft: HireDraft) =>
      new Map(
        draft.members.map((member) => [member.roleId, [member.botId, member.createCommandId]]),
      );

    expect(idsByRole(edited)).toEqual(idsByRole(hire));
    expect(edited.groupCommandId).toBe(hire.groupCommandId);
  });
});
