import { BotId, EnvironmentId, GroupId, ThreadId } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botNameMap, buildChatRows, chatPreviewLine, type ChatShell } from "./chats.logic";

const environmentId = EnvironmentId.make("env-one");

const bots = [
  { id: "bot-layla", name: "Layla" },
  { id: "bot-omar", name: "Omar" },
];

const groups = [{ id: "space-recruiting", name: "Recruiting" }];

interface ShellFixture {
  readonly id: string;
  readonly botId?: string | null;
  readonly groupId?: string | null;
  readonly parentThreadId?: string | null;
  readonly archivedAt?: string | null;
  readonly updatedAt?: string;
}

const shell = ({ id, botId, groupId, parentThreadId, ...rest }: ShellFixture): ChatShell => ({
  environmentId,
  archivedAt: null,
  updatedAt: "2026-08-27T00:00:00.000Z",
  ...rest,
  id: ThreadId.make(id),
  botId: botId == null ? null : BotId.make(botId),
  groupId: groupId == null ? null : GroupId.make(groupId),
  parentThreadId: parentThreadId == null ? null : ThreadId.make(parentThreadId),
});

describe("buildChatRows", () => {
  it("lists one row per owner, newest chat first, a space winning over its bot", () => {
    const rows = buildChatRows({
      environmentId,
      bots,
      groups,
      shells: [
        shell({ id: "a", botId: "bot-layla", updatedAt: "2026-08-27T10:00:00.000Z" }),
        shell({ id: "b", botId: "bot-layla", updatedAt: "2026-08-27T12:00:00.000Z" }),
        shell({
          id: "c",
          botId: "bot-omar",
          groupId: "space-recruiting",
          updatedAt: "2026-08-27T11:00:00.000Z",
        }),
        shell({ id: "d", botId: "bot-omar", updatedAt: "2026-08-26T09:00:00.000Z" }),
        shell({ id: "e", botId: "bot-omar", archivedAt: "2026-08-27T13:00:00.000Z" }),
        shell({ id: "f", botId: "bot-omar", parentThreadId: "d" }),
      ],
    });

    expect(rows.map((row) => [row.owner.name, row.threadId])).toEqual([
      ["Layla", "b"],
      ["Recruiting", "c"],
      ["Omar", "d"],
    ]);
  });

  it("names the speaker and flattens the markdown to one line", () => {
    const names = botNameMap(bots);

    expect(
      chatPreviewLine(
        { text: "## Plan\n\n**ship** it", role: "assistant", speakerBotId: "bot-omar" },
        names,
        "You",
      ),
    ).toEqual({ speaker: "Omar", text: "Plan ship it" });
    expect(
      chatPreviewLine({ text: "hello", role: "user", speakerBotId: null }, names, "You"),
    ).toEqual({ speaker: "You", text: "hello" });
    expect(
      chatPreviewLine({ text: "  ", role: "assistant", speakerBotId: null }, names, "You"),
    ).toBeNull();
  });
});
