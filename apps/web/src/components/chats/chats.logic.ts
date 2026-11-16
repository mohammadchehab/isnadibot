import type {
  BotId,
  EnvironmentId,
  GroupId,
  OrchestrationMessageRole,
  ThreadId,
} from "@isnadi/contracts";

import { flattenMarkdownPreview } from "../roster/rosterMessagePreview.logic";

/**
 * The shell fields a row reads. A full `EnvironmentThreadShell` satisfies it; the
 * narrower shape keeps fixtures plain strings.
 */
export interface ChatShell {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly botId?: BotId | null | undefined;
  readonly groupId?: GroupId | null | undefined;
  readonly parentThreadId?: ThreadId | null | undefined;
  readonly archivedAt: string | null;
  readonly updatedAt: string;
  readonly lastMessage?: ChatPreviewMessage | null | undefined;
}

/** The message fields a preview line reads. `OrchestrationThreadPreviewMessage` satisfies it. */
export interface ChatPreviewMessage {
  readonly text: string;
  readonly role: OrchestrationMessageRole;
  readonly speakerBotId: string | null;
}

export interface ChatOwner {
  readonly kind: "bot" | "group";
  readonly id: string;
  readonly name: string;
}

export interface ChatRow {
  readonly threadId: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly owner: ChatOwner;
  readonly updatedAt: string;
  readonly lastMessage: ChatPreviewMessage | null;
}

export interface ChatPreview {
  /** Who is speaking, or null when the speaker has no name to show. */
  readonly speaker: string | null;
  readonly text: string;
}

type Named = { readonly id: string; readonly name: string };

/**
 * The Chats page rows. One row per owner, not per chat: the row's name line is
 * the bot's or the space's name, so a second chat of the same bot would read as
 * the same row. That owner's newest chat stands for it, and a space wins over
 * the bot a space chat also names.
 */
export function buildChatRows(input: {
  readonly environmentId: EnvironmentId | null;
  readonly shells: ReadonlyArray<ChatShell>;
  readonly bots: ReadonlyArray<Named>;
  readonly groups: ReadonlyArray<Named>;
}): ChatRow[] {
  const { environmentId } = input;

  if (environmentId === null) return [];

  const botNames = new Map(input.bots.map((bot) => [bot.id, bot.name] as const));
  const groupNames = new Map(input.groups.map((group) => [group.id, group.name] as const));
  const newestByOwner = new Map<string, ChatRow>();

  for (const shell of input.shells) {
    if (shell.environmentId !== environmentId) continue;

    if (shell.archivedAt !== null || shell.parentThreadId != null) continue;

    const owner = resolveOwner(shell, botNames, groupNames);

    if (owner === null) continue;

    const row: ChatRow = {
      threadId: shell.id,
      environmentId,
      owner,
      updatedAt: shell.updatedAt,
      lastMessage: shell.lastMessage ?? null,
    };

    const key = `${owner.kind}:${owner.id}`;
    const current = newestByOwner.get(key);

    if (current === undefined || compareNewestFirst(row, current) < 0) {
      newestByOwner.set(key, row);
    }
  }

  return [...newestByOwner.values()].sort(compareNewestFirst);
}

/**
 * The `<Speaker>: <text>` preview line. Null when the chat has no message worth
 * a line, so the row falls back to showing nothing rather than an empty gap.
 */
export function chatPreviewLine(
  message: ChatPreviewMessage | null,
  botNames: ReadonlyMap<string, string>,
  youLabel: string,
): ChatPreview | null {
  if (message === null) return null;

  const text = flattenMarkdownPreview(message.text);

  if (text.length === 0) return null;

  return { speaker: resolveSpeaker(message, botNames, youLabel), text };
}

/** The bot names the preview lines need, keyed by id. */
export function botNameMap(bots: ReadonlyArray<Named>): ReadonlyMap<string, string> {
  return new Map(bots.map((bot) => [bot.id, bot.name] as const));
}

function resolveOwner(
  shell: ChatShell,
  botNames: ReadonlyMap<string, string>,
  groupNames: ReadonlyMap<string, string>,
): ChatOwner | null {
  const groupId = shell.groupId ?? null;

  if (groupId !== null) {
    const name = groupNames.get(groupId);

    if (name !== undefined) return { kind: "group", id: groupId, name };
  }

  const botId = shell.botId ?? null;

  if (botId !== null) {
    const name = botNames.get(botId);

    if (name !== undefined) return { kind: "bot", id: botId, name };
  }

  return null;
}

function resolveSpeaker(
  message: ChatPreviewMessage,
  botNames: ReadonlyMap<string, string>,
  youLabel: string,
): string | null {
  if (message.role === "user") return youLabel;

  if (message.role !== "assistant" || message.speakerBotId === null) return null;

  return botNames.get(message.speakerBotId) ?? null;
}

/** Newest first, the thread id breaking ties between two chats written in the same millisecond. */
function compareNewestFirst(left: ChatRow, right: ChatRow): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) || right.threadId.localeCompare(left.threadId)
  );
}
