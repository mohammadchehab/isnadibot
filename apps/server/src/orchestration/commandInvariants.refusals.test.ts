import { describe, expect, it } from "@effect/vitest";
import {
  BotId,
  CommandId,
  DelegationId,
  GroupId,
  McpServerId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@isnadi/contracts";
import * as Effect from "effect/Effect";

import {
  requireActiveGroupMember,
  requireBot,
  requireBotAbsent,
  requireBotArchived,
  requireBotNotArchived,
  requireDelegation,
  requireDelegationAbsent,
  requireGroup,
  requireGroupAbsent,
  requireGroupMember,
  requireGroupOwnedThreadMutationAuthorized,
  requireMcpServer,
  requireMcpServerAbsent,
  requireProject,
  requireProjectAbsent,
  requireProjectWorkspaceRootAbsent,
  requireThread,
  requireThreadAbsent,
  requireThreadArchived,
  requireThreadNotArchived,
} from "./commandInvariants.ts";
import type { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  BOSS_ID,
  GROUP_ID,
  NOW,
  makeBot,
  makeGroup,
  makeGroupThread,
  makeReadModel,
} from "./test-support/GroupDeciderFixtures.ts";

const ARCHIVED_BOT_ID = BotId.make("bot-archived");

const OUTSIDER_BOT_ID = BotId.make("bot-outsider");

const ACTIVE_THREAD_ID = ThreadId.make("thread-active");

const ARCHIVED_THREAD_ID = ThreadId.make("thread-archived");

const PROJECT_ID = ProjectId.make("project-1");

const DELEGATION_ID = DelegationId.make("delegation-1");

const MCP_SERVER_ID = McpServerId.make("mcp-1");

const WORKSPACE_ROOT = "/tmp/owned";

/**
 * One read model holding every entity these lookups can miss or collide with,
 * so each case below fails for exactly the reason it names and nothing else.
 */
const readModel: OrchestrationReadModel = {
  ...makeReadModel({
    bots: [
      makeBot({ id: BOSS_ID, groupId: GROUP_ID }),
      makeBot({ id: ARCHIVED_BOT_ID, groupId: GROUP_ID, archivedAt: NOW }),
      makeBot({ id: OUTSIDER_BOT_ID }),
    ],
    // Only the archived bot is a member, so the boss is the outsider these
    // cases use to reach the membership refusal.
    groups: [makeGroup({ members: [{ kind: "bot", botId: ARCHIVED_BOT_ID, role: "specialist" }] })],
    threads: [
      { ...makeGroupThread(), id: ACTIVE_THREAD_ID, archivedAt: null },
      { ...makeGroupThread(), id: ARCHIVED_THREAD_ID, archivedAt: NOW },
    ],
  }),
  projects: [
    {
      id: PROJECT_ID,
      title: "Project",
      workspaceRoot: WORKSPACE_ROOT,
      defaultModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    },
  ],
  delegations: [
    {
      delegationId: DELEGATION_ID,
      parentDelegationId: null,
      parentBotId: BOSS_ID,
      childBotId: ARCHIVED_BOT_ID,
      parentThreadId: ACTIVE_THREAD_ID,
      parentTurnId: TurnId.make("turn-parent"),
      ancestorBotIds: [BOSS_ID],
      depth: 1,
      task: "Compare three flights.",
      expectedResult: "A short comparison.",
      deadline: null,
      access: {
        allowedToolIds: [],
        memoryScopes: [],
        sandbox: "local",
        runtimeMode: "approval-required",
        hasUserComputer: false,
        enabledMcpServerIds: [],
        disabledMcpServerIds: [],
        approvalCeiling: "send",
      },
      billedBotId: ARCHIVED_BOT_ID,
      keep: false,
      anchorMessageId: null,
      retryOfDelegationId: null,
      trigger: "bot",
      createdAt: NOW,
      updatedAt: NOW,
      phase: { _tag: "Queued" },
    },
  ],
  mcpServers: [
    {
      id: MCP_SERVER_ID,
      name: "Search",
      transport: "url",
      url: "https://example.com/mcp",
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    },
  ],
};

/** Any valid command works: these lookups read nothing from it but its type. */
const command: OrchestrationCommand = {
  type: "bot.archive",
  commandId: CommandId.make("cmd-refusal"),
  botId: BOSS_ID,
};

type RefusalCase = {
  readonly name: string;
  readonly id: string;
  readonly run: () => Effect.Effect<unknown, OrchestrationCommandInvariantError>;
};

const staleViewCases: ReadonlyArray<RefusalCase> = [
  {
    name: "project",
    id: "project-gone",
    run: () => requireProject({ readModel, command, projectId: ProjectId.make("project-gone") }),
  },
  {
    name: "bot",
    id: "bot-gone",
    run: () => requireBot({ readModel, command, botId: BotId.make("bot-gone") }),
  },
  {
    name: "delegation",
    id: "delegation-gone",
    run: () =>
      requireDelegation({
        readModel,
        command,
        delegationId: DelegationId.make("delegation-gone"),
      }),
  },
  {
    name: "MCP server",
    id: "mcp-gone",
    run: () =>
      requireMcpServer({
        readModel,
        command,
        mcpServerId: McpServerId.make("mcp-gone"),
      }),
  },
  {
    name: "group",
    id: "group-gone",
    run: () => requireGroup({ readModel, command, groupId: GroupId.make("group-gone") }),
  },
  {
    name: "group of a thread being mutated",
    id: "group-of-thread-gone",
    run: () =>
      requireGroupOwnedThreadMutationAuthorized({
        readModel,
        thread: { ...makeGroupThread(), groupId: GroupId.make("group-of-thread-gone") },
        command,
        actor: undefined,
      }),
  },
  {
    name: "thread",
    id: "thread-gone",
    run: () => requireThread({ readModel, command, threadId: ThreadId.make("thread-gone") }),
  },
  {
    // The entity is fine, the screen is wrong: another device archived it
    // already, so a refresh is the whole remedy.
    name: "bot already archived elsewhere",
    id: BOSS_ID,
    run: () => requireBotArchived({ readModel, command, botId: BOSS_ID }),
  },
  {
    name: "thread already archived elsewhere",
    id: ACTIVE_THREAD_ID,
    run: () => requireThreadArchived({ readModel, command, threadId: ACTIVE_THREAD_ID }),
  },
];

const alreadyExistsCases: ReadonlyArray<RefusalCase> = [
  {
    name: "project",
    id: PROJECT_ID,
    run: () => requireProjectAbsent({ readModel, command, projectId: PROJECT_ID }),
  },
  {
    name: "bot",
    id: BOSS_ID,
    run: () => requireBotAbsent({ readModel, command, botId: BOSS_ID }),
  },
  {
    name: "delegation",
    id: DELEGATION_ID,
    run: () => requireDelegationAbsent({ readModel, command, delegationId: DELEGATION_ID }),
  },
  {
    name: "MCP server",
    id: MCP_SERVER_ID,
    run: () => requireMcpServerAbsent({ readModel, command, mcpServerId: MCP_SERVER_ID }),
  },
  {
    name: "group",
    id: GROUP_ID,
    run: () => requireGroupAbsent({ readModel, command, groupId: GROUP_ID }),
  },
  {
    name: "thread",
    id: ACTIVE_THREAD_ID,
    run: () => requireThreadAbsent({ readModel, command, threadId: ACTIVE_THREAD_ID }),
  },
];

const entityArchivedCases: ReadonlyArray<RefusalCase> = [
  {
    name: "archived bot",
    id: ARCHIVED_BOT_ID,
    run: () => requireBotNotArchived({ readModel, command, botId: ARCHIVED_BOT_ID }),
  },
  {
    name: "archived bot that cannot respond",
    id: ARCHIVED_BOT_ID,
    run: () =>
      requireActiveGroupMember({ readModel, command, groupId: GROUP_ID, botId: ARCHIVED_BOT_ID }),
  },
  {
    name: "archived thread",
    id: ARCHIVED_THREAD_ID,
    run: () => requireThreadNotArchived({ readModel, command, threadId: ARCHIVED_THREAD_ID }),
  },
];

const workspaceRootCases: ReadonlyArray<RefusalCase> = [
  {
    name: "folder another project owns",
    id: PROJECT_ID,
    run: () =>
      requireProjectWorkspaceRootAbsent({ readModel, command, workspaceRoot: WORKSPACE_ROOT }),
  },
];

const membershipCases: ReadonlyArray<RefusalCase> = [
  {
    name: "bot outside the group",
    id: BOSS_ID,
    run: () => requireGroupMember({ readModel, command, groupId: GROUP_ID, botId: BOSS_ID }),
  },
];

const casesByCode: ReadonlyArray<{
  readonly code: string;
  readonly cases: ReadonlyArray<RefusalCase>;
}> = [
  { code: "stale-view", cases: staleViewCases },
  { code: "already-exists", cases: alreadyExistsCases },
  { code: "entity-archived", cases: entityArchivedCases },
  { code: "workspace-root-in-use", cases: workspaceRootCases },
  { code: "bot-not-a-group-member", cases: membershipCases },
];

/** The refusal an effect failed with, or a defect if it unexpectedly succeeded. */
const refusalOf = (effect: Effect.Effect<unknown, OrchestrationCommandInvariantError>) =>
  Effect.matchEffect(effect, {
    onFailure: (error) => Effect.succeed(error),
    onSuccess: () => Effect.die(new Error("expected the command to be refused")),
  });

describe("commandInvariants refusals", () => {
  for (const { code, cases } of casesByCode) {
    for (const { name, id, run } of cases) {
      it.effect(`codes a ${name} refusal as ${code}`, () =>
        Effect.gen(function* () {
          const error = yield* refusalOf(run());

          expect(error.refusal).toBe(code);
          // The prose stays on `detail` as the log line and as the fallback for
          // a client that does not know the code, so the id it names must
          // survive.
          expect(error.detail).toContain(id);
        }),
      );
    }
  }
});
