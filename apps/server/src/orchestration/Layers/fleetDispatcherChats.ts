import {
  ProviderInstanceId,
  isGroupBotMember,
  type BotId,
  type ModelSelection,
  type OrchestrationBot,
  type OrchestrationGroup,
  type OrchestrationProject,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@isnadi/contracts";

/**
 * The chat a bot works in: its own, most recently active one first.
 *
 * Archived and deleted chats are not work: a turn started in an archived chat would land
 * somewhere the user has hidden, so it reads as nothing having happened.
 */
export function botChat(
  readModel: OrchestrationReadModel,
  botId: BotId,
): OrchestrationThread | undefined {
  return readModel.threads
    .filter(
      (thread) => thread.botId === botId && thread.deletedAt === null && thread.archivedAt === null,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

/** The most recently updated of some chats, which is the one that says where work happens. */
const newestChat = (threads: ReadonlyArray<OrchestrationThread>): OrchestrationThread | undefined =>
  threads.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];

/**
 * The project a chat created for this group belongs in.
 *
 * Neither the group nor the bot carries a project, so the answer is read from where the team
 * already works: the space's own most recent chat, then any member's most recent chat, then the
 * environment's only active project. With several projects and no chat to read there is no honest
 * answer — guessing would file the bot's work in the wrong workspace — so this returns
 * `undefined` and the dispatcher waits for a chat to appear.
 */
export function chatProjectFor(
  readModel: OrchestrationReadModel,
  group: OrchestrationGroup,
): OrchestrationProject | undefined {
  const live = readModel.threads.filter((thread) => thread.deletedAt === null);
  const memberIds = new Set(group.members.filter(isGroupBotMember).map((member) => member.botId));

  const inSpace = newestChat(live.filter((thread) => thread.groupId === group.id));

  const inMember = newestChat(
    live.filter(
      (thread) =>
        thread.botId !== null && thread.botId !== undefined && memberIds.has(thread.botId),
    ),
  );

  const projects = readModel.projects.filter((project) => project.deletedAt === null);

  for (const chat of [inSpace, inMember]) {
    if (chat === undefined) continue;

    const project = projects.find((candidate) => candidate.id === chat.projectId);

    if (project !== undefined) return project;
  }

  return projects.length === 1 ? projects[0] : undefined;
}

/**
 * The model a chat created for this bot runs on: the bot's own engine when it has one, otherwise
 * the project's default. `undefined` means neither names a model, which is a bot that cannot
 * start a turn at all.
 */
export function chatModelSelection(
  bot: OrchestrationBot,
  project: OrchestrationProject,
): ModelSelection | undefined {
  if (bot.engine === null) return project.defaultModelSelection ?? undefined;

  return {
    instanceId: ProviderInstanceId.make(bot.engine.provider),
    model: bot.engine.model,
    ...(bot.engine.options === undefined ? {} : { options: bot.engine.options }),
  };
}
