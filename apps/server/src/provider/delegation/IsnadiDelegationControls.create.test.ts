import {
  AuthSessionId,
  BotId,
  CommandId,
  GroupId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type CommandRefusal,
  type OrchestrationBot,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationGroup,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decideOrchestrationCommand } from "../../orchestration/decider.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import { createEmptyReadModel } from "../../orchestration/projector.ts";
import { applyCommand } from "../../orchestration/test-support/GroupDeciderFixtures.ts";
import { createIsnadiDelegationControls } from "./IsnadiDelegationControls.ts";
import type { IsnadiDelegationParent } from "./IsnadiDelegationPolicy.ts";

const NOW = "2026-11-15T09:00:00.000Z";

const ROOT_ID = BotId.make("bot-root");

const GROUP_ID = GroupId.make("group-space");

const THREAD_ID = ThreadId.make("thread-parent");

const person = { personId: AuthSessionId.make("person-1"), canManageGroups: true };

// Every bot the chain names, so a test can say "this bot was made by that one".
function bot(id: BotId, createdByBotId: BotId | null): OrchestrationBot {
  return {
    id,
    name: String(id),
    title: "Agent",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    skills: [],
    skillRegistryAccess: false,
    avatar: { kind: "dither", seed: String(id) },
    engine: null,
    sandbox: "local",
    runtimeMode: "full-access",
    imageProvider: null,
    voiceEnabled: false,
    channelBindings: [],
    groupId: null,
    createdByBotId,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function space(): OrchestrationGroup {
  return {
    id: GROUP_ID,
    name: "Space",
    bossBotId: ROOT_ID,
    members: [{ kind: "bot", botId: ROOT_ID, role: "boss" }],
    keepBusy: false,
    fleetTemplateId: null,
    createdByBotId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// The parent session's own chat: a space chat when `inSpace`, otherwise a plain
// one-to-one chat, which has no space to count creations in.
function parentThread(inSpace: boolean): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    botId: ROOT_ID,
    groupId: inSpace ? GROUP_ID : null,
    respondingBotId: ROOT_ID,
    title: "Parent",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as OrchestrationThread;
}

function parent(botId: BotId): IsnadiDelegationParent {
  return {
    threadId: THREAD_ID,
    turnId: TurnId.make("turn-parent"),
    botId,
    parentDelegationId: null,
    ancestorBotIds: [],
    depth: 0,
    access: {
      allowedToolIds: ["CreateAgent"],
      memoryScopes: ["private"],
      sandbox: "local",
      runtimeMode: "full-access",
      hasUserComputer: false,
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
      approvalCeiling: "send",
    },
  } as IsnadiDelegationParent;
}

/**
 * Drives the real tool path. `create` reads a snapshot and dispatches the
 * `bot.create` it derived; the command it dispatched is handed back so the test
 * can decide it through the real decider and project the result.
 */
function controlsFor(initial: OrchestrationReadModel) {
  const commands: OrchestrationCommand[] = [];

  const dispatch = async (command: OrchestrationCommand) => {
    commands.push(command);
  };

  const controls = createIsnadiDelegationControls(
    {
      readSnapshot: async () => initial,
      defaultSandbox: async () => "local",
      dispatch,
      awaitChild: async () => ({ status: "completed" }) as never,
      interruptChild: async () => undefined,
    },
    () => NOW,
    () => "made",
    (label) => CommandId.make(`cmd-${label}`),
    dispatch,
    async () => undefined,
  );

  return { controls, commands };
}

// A root a person made, plus `count` bots it made — the chain at its ceiling.
function readModelWithChain(count: number, inSpace: boolean): OrchestrationReadModel {
  const made = Array.from({ length: count }, (_, index) =>
    bot(BotId.make(`bot-made-${index}`), ROOT_ID),
  );

  return {
    ...createEmptyReadModel(NOW),
    bots: [bot(ROOT_ID, null), ...made],
    groups: inSpace ? [space()] : [],
    threads: [parentThread(inSpace)],
  };
}

const isInvariantError = Schema.is(OrchestrationCommandInvariantError);

function refusalOf(cause: unknown): CommandRefusal | undefined {
  return isInvariantError(cause) ? cause.refusal : undefined;
}

/**
 * Creates through the tool path, then decides the command it dispatched.
 * `refusal` is set when the decider refused the command; `events` holds what it
 * persisted when it accepted it.
 */
const createAndDecide = (model: OrchestrationReadModel, creatorBotId: BotId, name: string) =>
  Effect.gen(function* () {
    const { controls, commands } = controlsFor(model);
    const made = yield* Effect.promise(() => controls.create(parent(creatorBotId), { name }));

    const outcome = yield* applyCommand(model, commands[0]!).pipe(
      Effect.match({
        onFailure: (cause) => ({
          refusal: refusalOf(cause),
          events: [] as ReadonlyArray<OrchestrationEvent>,
        }),
        onSuccess: (result) => ({ refusal: undefined, events: result.events }),
      }),
    );

    return { made, commands, ...outcome };
  });

it.layer(NodeServices.layer)("a bot creating a bot", (it) => {
  it.effect("stops at the breadth ceiling in a space chat", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(5, true);
      const { refusal } = yield* createAndDecide(model, ROOT_ID, "extra");

      expect(refusal).toBe("bot-creation-limit-reached");
    }),
  );

  // The reason the ceiling counts a creator chain rather than a space: a bot in a
  // plain chat creates into no space at all.
  it.effect("stops at the breadth ceiling in a plain chat too", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(5, false);
      const { commands, refusal } = yield* createAndDecide(model, ROOT_ID, "extra");

      expect(commands[0]).toMatchObject({ groupId: null });
      expect(refusal).toBe("bot-creation-limit-reached");
    }),
  );

  it.effect("allows the sixth bot once the user has archived one", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(5, true);
      const [root, first, ...rest] = model.bots;

      const { refusal } = yield* createAndDecide(
        { ...model, bots: [root!, { ...first!, archivedAt: NOW }, ...rest] },
        ROOT_ID,
        "replacement",
      );

      expect(refusal).toBeUndefined();
    }),
  );

  it.effect("stops a chain that is already three bots deep", () =>
    Effect.gen(function* () {
      const deep = [
        bot(ROOT_ID, null),
        bot(BotId.make("bot-a"), ROOT_ID),
        bot(BotId.make("bot-b"), BotId.make("bot-a")),
        bot(BotId.make("bot-c"), BotId.make("bot-b")),
      ];

      const model: OrchestrationReadModel = {
        ...createEmptyReadModel(NOW),
        bots: deep,
        threads: [parentThread(false)],
      };

      const { refusal } = yield* createAndDecide(model, BotId.make("bot-c"), "too-deep");

      expect(refusal).toBe("bot-creation-chain-too-deep");
    }),
  );

  it.effect("records the creator on the event", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(0, true);
      const { made, events } = yield* createAndDecide(model, ROOT_ID, "child");

      // A space chat also seats the new bot as a member, so the creation is not
      // necessarily the first event.
      const created = events.find((event) => event.type === "bot.created");

      expect(created).toMatchObject({ payload: { createdByBotId: ROOT_ID } });
      expect(made.name).toBe("child");
    }),
  );

  it.effect("leaves a person's own creation alone at the same ceiling", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(5, true);

      const decided = yield* decideOrchestrationCommand({
        command: {
          type: "bot.create",
          commandId: CommandId.make("cmd-person-create"),
          botId: BotId.make("bot-person-made"),
          name: "person-made",
          title: "Agent",
          label: null,
          description: null,
          disabledMcpServerIds: [],
          avatar: { kind: "dither", seed: "person-made" },
          engine: null,
          sandbox: "local",
          runtimeMode: "full-access",
          imageProvider: null,
          voiceEnabled: false,
          groupId: null,
          createdAt: NOW,
        },
        readModel: model,
        actor: person,
      });

      const events = Array.isArray(decided) ? decided : [decided];

      expect(events.map((event) => event.type)).toContain("bot.created");
    }),
  );

  it.effect("refuses a client command that names a creator", () =>
    Effect.gen(function* () {
      const model = readModelWithChain(0, true);

      const error = yield* decideOrchestrationCommand({
        command: {
          type: "bot.create",
          commandId: CommandId.make("cmd-laundered"),
          botId: BotId.make("bot-laundered"),
          name: "laundered",
          title: "Agent",
          label: null,
          description: null,
          disabledMcpServerIds: [],
          avatar: { kind: "dither", seed: "laundered" },
          engine: null,
          sandbox: "local",
          runtimeMode: "full-access",
          imageProvider: null,
          voiceEnabled: false,
          groupId: null,
          createdByBotId: ROOT_ID,
          createdAt: NOW,
        },
        readModel: model,
        actor: person,
      }).pipe(Effect.flip);

      expect(refusalOf(error)).toBe("bot-origin-forbidden");
    }),
  );
});
