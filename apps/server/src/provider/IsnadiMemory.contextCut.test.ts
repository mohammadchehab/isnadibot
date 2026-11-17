import { partialSdkFixture } from "./test-support/partialSdkFixture.ts";
import { MessageList } from "@mastra/core/agent";
import { RequestContext } from "@mastra/core/request-context";
import { Memory } from "@mastra/memory";
import { ObservationalMemory } from "@mastra/memory/processors";
import type { HandoffDoc } from "@isnadi/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { IsnadiPassiveObservationalMemoryProcessor } from "./mastra/IsnadiMemory.ts";

const RESET_AT = "2026-08-31T20:00:10.000Z";

const doc: HandoffDoc = {
  item: "Ship the handoff engine.",
  branch: "feature/task-84-handoff-engine",
  done: "The reactor dispatches the cut.",
  nextStep: "Write the tests.",
  waitingOn: "",
  doNot: "Do not merge.",
};

const savedMessage = (id: string, role: "user" | "assistant", text: string) => ({
  id,
  role,
  createdAt: new Date("2026-08-31T20:00:00.000Z"),
  threadId: "thread-1",
  resourceId: "thread-1",
  content: { format: 2 as const, parts: [{ type: "text" as const, text }] },
});

const contextCut = (sinceMessageId: string) => ({
  sinceMessageId,
  resetAt: RESET_AT,
  doc,
});

const requestContext = (cut: ReturnType<typeof contextCut> | undefined) => {
  const context = new RequestContext();
  context.set("controller", { state: cut === undefined ? {} : { contextCut: cut } });

  return context;
};

const makeProcessor = (input: {
  readonly history: ReadonlyArray<ReturnType<typeof savedMessage>>;
  readonly lastObservedAt?: Date;
  readonly chunks?: ReadonlyArray<string>;
}) => {
  const buildContextSystemMessages = vi.fn(async () => [...(input.chunks ?? [])]);

  const engine = partialSdkFixture<ObservationalMemory>({
    getThreadContext: vi.fn(() => ({ threadId: "thread-1", resourceId: "thread-1" })),
    loadUnobservedMessages: vi.fn(async () => []),
    getOrCreateRecord: vi.fn(async () => ({
      activeObservations: "",
      ...(input.lastObservedAt ? { lastObservedAt: input.lastObservedAt } : {}),
    })),
    buildContextSystemMessages,
  });

  const processor = new IsnadiPassiveObservationalMemoryProcessor(
    engine,
    partialSdkFixture<Memory>({
      recall: vi.fn(async () => ({ messages: [...input.history] })),
      persistMessages: vi.fn(async () => undefined),
    }),
  );

  return { processor, buildContextSystemMessages };
};

const recalledIds = (messageList: MessageList) =>
  messageList.get.all
    .db()
    .filter((message) => message.role !== "system")
    .map((message) => message.id);

const systemText = (messageList: MessageList, tag: string) =>
  messageList
    .getSystemMessages(tag)
    .map((message) => message.content)
    .join("\n");

describe("a bot's context after a handoff (TASK-84)", () => {
  it("opens on the note and reads the chat from its cut", async () => {
    const { processor } = makeProcessor({
      history: [
        savedMessage("u1", "user", "first question"),
        savedMessage("a1", "assistant", "first answer"),
        savedMessage("u2", "user", "now hand off"),
        savedMessage("a2", "assistant", "here is the note"),
        savedMessage("u3", "user", "carry on"),
        savedMessage("a3", "assistant", "carrying on"),
      ],
    });

    const messageList = new MessageList({ threadId: "thread-1", resourceId: "thread-1" });

    await processor.processInputStep({
      stepNumber: 0,
      messageList,
      requestContext: requestContext(contextCut("a1")),
    } as never);

    expect(recalledIds(messageList)).toEqual(["u2", "a2", "u3", "a3"]);
    expect(systemText(messageList, "isnadi-handoff")).toContain("Next: Write the tests.");
    expect(systemText(messageList, "isnadi-handoff")).not.toContain("Waiting on");
  });

  it("leaves the whole chat in context when no handoff cut it", async () => {
    const { processor } = makeProcessor({
      history: [
        savedMessage("u1", "user", "first question"),
        savedMessage("a1", "assistant", "first answer"),
      ],
    });

    const messageList = new MessageList({ threadId: "thread-1", resourceId: "thread-1" });

    await processor.processInputStep({
      stepNumber: 0,
      messageList,
      requestContext: requestContext(undefined),
    } as never);

    expect(recalledIds(messageList)).toEqual(["u1", "a1"]);
    expect(messageList.getSystemMessages("isnadi-handoff")).toEqual([]);
  });

  it("leaves out observations whatever the observer's cursor says, because none of it is attributable to after the cut", async () => {
    for (const lastObservedAt of [
      new Date("2026-08-31T20:00:00.000Z"),
      new Date("2026-08-31T20:00:20.000Z"),
    ]) {
      const { processor, buildContextSystemMessages } = makeProcessor({
        history: [],
        lastObservedAt,
        chunks: ["the bot is writing the tests"],
      });

      const messageList = new MessageList({ threadId: "thread-1", resourceId: "thread-1" });

      await processor.processInputStep({
        stepNumber: 0,
        messageList,
        requestContext: requestContext(contextCut("a1")),
      } as never);

      expect(buildContextSystemMessages).not.toHaveBeenCalled();
      expect(messageList.getSystemMessages("observational-memory")).toEqual([]);
    }
  });
});
