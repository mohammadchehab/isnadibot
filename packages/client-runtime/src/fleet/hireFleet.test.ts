import {
  EnvironmentId,
  FLEET_TEMPLATES,
  FleetRoleId,
  GROUP_HOP_BUDGET_DEFAULT,
  GroupHopBudget,
  ORCHESTRATION_WS_METHODS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ClientOrchestrationCommand,
  type FleetHireCommand,
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
import * as Socket from "effect/unstable/socket/Socket";

import { testRpcClient } from "../test-support/services.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type * as RpcSession from "../rpc/session.ts";

import {
  createHireDraft,
  draftBlockers,
  draftLocked,
  hireFleet,
  setBoss,
  setHopBudget,
  setMemberModel,
  setMemberReasoning,
  type HireDraft,
  type HireFleetResult,
} from "./hireFleet.ts";

const template = FLEET_TEMPLATES.find(
  (candidate) => candidate.id === "recruiting",
) as FleetTemplate;

/** The draft's screens ask Crypto for remains, so each hire effect provides one. */
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
  /**
   * How that dispatch fails. A refused command is `defect`, the default; a
   * dropped socket is `socket`, whose outcome the client cannot know.
   */
  readonly failAs?: "defect" | "socket";
}

/** The failure a dispatch at `failAt` answers with, the way a real client would see it. */
function dispatchFailure(failAs: DispatchLog["failAs"]): RpcClientError.RpcClientError {
  if (failAs === "socket") {
    return new RpcClientError.RpcClientError({
      reason: new Socket.SocketCloseError({ code: 1006 }),
    });
  }

  return new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({
      message: "socket closed",
      cause: new Error("socket closed"),
    }),
  });
}

const makeSupervisor = Effect.fn("TestHireFleet.makeSupervisor")(function* (log: DispatchLog) {
  const client = testRpcClient({
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.gen(function* () {
        log.commands.push(command);

        if (log.failAt === log.commands.length) {
          return yield* dispatchFailure(log.failAs);
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

/** Mints ids in call order, so a test can name the command id it expects. */
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

/** Just the hires a log holds: a squad is one command, never a create per member. */
const hireCommands = (log: DispatchLog): ReadonlyArray<FleetHireCommand> =>
  log.commands.filter((command): command is FleetHireCommand => command.type === "fleet.hire");

/** The picks a draft sends, in the order its members stand. */
const picksOf = (hire: HireDraft) =>
  hire.members.flatMap((member) =>
    member.engine === null ? [] : [{ roleId: member.roleId, engine: member.engine }],
  );

/** The draft a failed hire hands back, for the retry the next case drives. */
function failedDraft(result: HireFleetResult): HireDraft {
  if (result.status !== "failed") {
    throw new Error(`Expected a failed hire, got '${result.status}'.`);
  }

  return result.draft;
}

describe("createHireDraft", () => {
  it("seeds every member boss first, under one command id for the whole hire", () => {
    const hire = draft();

    expect(hire.members.map((member) => member.roleId)).toEqual([
      template.bossRoleId,
      ...template.roleIds.filter((roleId) => roleId !== template.bossRoleId),
    ]);
    expect(hire.members.every((member) => member.engine !== null)).toBe(true);
    expect(hire.commandId).toBe("id-1");
    expect(hire.hopBudget).toBe(GroupHopBudget.make(GROUP_HOP_BUDGET_DEFAULT));
    expect(hire.send).toEqual({ status: "draft" });
    expect(hire.templateIndex).toBe(
      FLEET_TEMPLATES.findIndex((candidate) => candidate.id === template.id),
    );
  });
});

describe("hireFleet", () => {
  it.effect("sends one command naming every member's picked engine", () =>
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
        "fleet.hire",
      ]);
      expect(hireCommands(log)[0]).toMatchObject({
        commandId: hire.commandId,
        templateIndex: hire.templateIndex,
        picks: picksOf(hire),
        createdAt: hire.createdAt,
      });
      // The template's ids never cross the wire: the server derives them from the index.
      expect(hireCommands(log)[0]).not.toHaveProperty("fleetTemplateId");
      expect(hireCommands(log)[0]).not.toHaveProperty("groupId");
      expect(result).toEqual({ status: "sent", sequence: 1 });
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends the boss and reply budget picked on screen", () =>
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

      const command = hireCommands(log)[0];

      expect(command).toMatchObject({ bossRoleId: "coach", hopBudget: 3 });
      expect(command?.picks[0]?.roleId).toBe("coach");
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("leaves the boss out of the command when it is the template's own", () =>
    Effect.gen(function* () {
      const log: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: draft(), makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
      );

      expect(hireCommands(log)[0]).not.toHaveProperty("bossRoleId");
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends nothing while a member has no engine", () =>
    Effect.gen(function* () {
      const hire = draft([]);
      const log: DispatchLog = { commands: [] };

      const result = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
      );

      expect(result.status).toBe("blocked");
      expect(log.commands).toEqual([]);
      expect(draftBlockers(hire).every((blocker) => blocker.kind === "no-provider")).toBe(true);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("sends nothing while a member is pinned to a model the server dropped", () =>
    Effect.gen(function* () {
      const hire = setMemberModel(
        draft(),
        FleetRoleId.make("tailor"),
        { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-retired" },
        PROVIDERS,
      );

      expect(draftBlockers(hire)).toContainEqual({
        kind: "no-provider",
        roleId: FleetRoleId.make("tailor"),
      });

      const log: DispatchLog = { commands: [] };

      const result = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(log),
        ),
      );

      expect(result.status).toBe("blocked");
      expect(log.commands).toEqual([]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("resends the draft's own command id after a failed send", () =>
    Effect.gen(function* () {
      const hire = draft();
      const first: DispatchLog = { commands: [], failAt: 1 };

      const attempt = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(first),
        ),
      );

      expect(attempt).toMatchObject({ status: "failed", outcome: "failed" });

      const failed = failedDraft(attempt);

      expect(failed.send).toEqual({ status: "failed", edited: false });

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: failed, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      // The server keys the hire on the id, so the retry replays instead of hiring twice.
      expect(hireCommands(first)[0]?.commandId).toBe(hire.commandId);
      expect(hireCommands(retried)[0]?.commandId).toBe(hire.commandId);
      expect(retried.commands).toHaveLength(1);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("mints a fresh command id when a failed send is followed by an edit", () =>
    Effect.gen(function* () {
      const hire = draft();
      const first: DispatchLog = { commands: [], failAt: 1 };

      const attempt = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(first),
        ),
      );

      const edited = setMemberModel(
        failedDraft(attempt),
        FleetRoleId.make("tailor"),
        { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-opus-5-5" },
        PROVIDERS,
      );

      expect(edited.send).toEqual({ status: "failed", edited: true });

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: edited, makeId: () => "fresh-command-id" }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      const command = hireCommands(retried)[0];

      // The old id answered for the engines the user has since changed.
      expect(command?.commandId).toBe("fresh-command-id");
      expect(command?.picks.find((pick) => pick.roleId === "tailor")?.engine.model).toBe(
        "claude-opus-5-5",
      );
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("keeps the command id and locks the draft when the send may have landed", () =>
    Effect.gen(function* () {
      const hire = draft();
      const first: DispatchLog = { commands: [], failAt: 1, failAs: "socket" };

      const attempt = yield* hireFleet({ draft: hire, makeId: makeIdFactory() }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(first),
        ),
      );

      expect(attempt).toMatchObject({ status: "failed", outcome: "unknown" });

      const locked = failedDraft(attempt);

      expect(locked.commandId).toBe(hire.commandId);
      expect(draftLocked(locked)).toBe(true);

      // Nothing may edit a draft whose hire the server may already hold.
      expect(setBoss(locked, FleetRoleId.make("coach"))).toBe(locked);
      expect(setHopBudget(locked, GroupHopBudget.make(2))).toBe(locked);
      expect(
        setMemberModel(
          locked,
          FleetRoleId.make("tailor"),
          { instanceId: ProviderInstanceId.make("claude-1"), model: "claude-opus-5-5" },
          PROVIDERS,
        ),
      ).toBe(locked);
      expect(setMemberReasoning(locked, FleetRoleId.make("tailor"), [])).toBe(locked);

      const retried: DispatchLog = { commands: [] };

      yield* hireFleet({ draft: locked, makeId: () => "fresh-command-id" }).pipe(
        Effect.provideService(
          EnvironmentSupervisor.EnvironmentSupervisor,
          yield* makeSupervisor(retried),
        ),
      );

      // The resend asks what the first attempt did, so it carries the same id.
      expect(hireCommands(retried)[0]?.commandId).toBe(hire.commandId);
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

describe("a draft's one command id", () => {
  it("survives every edit, so a retry finishes the hire it started", () => {
    const hire = draft();

    const edited = setMemberReasoning(
      setHopBudget(setBoss(hire, FleetRoleId.make("scout")), GroupHopBudget.make(2)),
      FleetRoleId.make("scout"),
      [{ id: "reasoningEffort", value: "high" }],
    );

    expect(edited.commandId).toBe(hire.commandId);
    expect(edited.send).toEqual({ status: "draft" });
  });
});
