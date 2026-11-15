import * as NodeFS from "node:fs";

import { EnvironmentId, ThreadId } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { memoryDocumentCopy } from "./botMemoryCopy";
import { resolveBotThreadTarget } from "./botThreadRuntime.logic";

describe("BotMemorySheet", () => {
  it("renders direct document editors, limits, and chat summary controls", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemorySheet.tsx", import.meta.url), "utf8");
    expect(source).toContain('data-testid="memory-documents"');
    expect(source).toContain("document.charLimit");
    expect(source).toContain("Chat summary");
    expect(source).toContain("Earlier summaries");
    expect(source).toContain("Confirm clear");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("font-mono");
  });

  it("names every memory document in plain language and keeps its file name", () => {
    expect(memoryDocumentCopy.user).toMatchObject({ title: "About you", fileName: "USER.md" });
    expect(memoryDocumentCopy.memory).toMatchObject({ title: "Bot notes", fileName: "MEMORY.md" });
    expect(memoryDocumentCopy.group).toMatchObject({ title: "Group notes", fileName: "GROUP.md" });
  });

  it("imports backups through an app button instead of a raw file input", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemoryTransfer.tsx", import.meta.url), "utf8");
    expect(source).toContain('type="file"');
    expect(source).toContain('className="sr-only"');
    expect(source).toContain("fileInputRef.current?.click()");
    expect(source).toContain('t("Import memory archive")');
  });

  it("keeps durable facts in their own section apart from chat memory", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemorySheet.tsx", import.meta.url), "utf8");
    const durable = NodeFS.readFileSync(new URL("./BotDurableMemory.tsx", import.meta.url), "utf8");
    expect(source.indexOf("Observational memory")).toBeLessThan(
      source.indexOf("<BotDurableMemory"),
    );
    expect(durable).toContain("Durable facts");
    expect(durable).toContain("DURABLE_MEMORY_INSPECT_SCOPES");
    expect(durable).toContain("Clearing chat observations does not remove them.");
  });

  it("opens memory imports from an app button instead of a native file control", () => {
    const transfer = NodeFS.readFileSync(
      new URL("./BotMemoryTransfer.tsx", import.meta.url),
      "utf8",
    );

    expect(transfer).toContain("onClick={() => fileInputRef.current?.click()}");
    expect(transfer).toMatch(/>\s*\{t\("Import memory archive"\)\}\s*</);
    expect(transfer).toMatch(/<input\s+ref=\{fileInputRef\}\s+className="sr-only"/);
    expect(transfer).not.toContain('aria-label={t("Import memory archive")}');
  });

  it("shows every failure through the shared helper, so a blank message falls back", () => {
    const source = NodeFS.readFileSync(new URL("./BotMemorySheet.tsx", import.meta.url), "utf8");

    // No private cause.message echo: the sheet had one, and it returned "" for an
    // error with no message, which the toast rendered as an empty description and
    // the inline error treated as falsy. Both paths now go through the shared
    // helper, which falls back to this surface's own sentence.
    expect(source).not.toContain("memoryErrorMessage");
    expect(source).not.toContain("cause instanceof Error ? cause.message");
    expect(source).toContain("commandFailureMessage");
    expect(source.match(/commandFailureMessage\(result/g)).toHaveLength(2);
    expect(source.match(/fallback: "Memory request failed\."/g)).toHaveLength(2);
  });

  it("wires the authorized bot thread into the panel", () => {
    const route = NodeFS.readFileSync(
      new URL("../../routes/_chat.bots.$botId.tsx", import.meta.url),
      "utf8",
    );

    expect(route).toContain("useBotThreadRef(botId)");
    expect(route).toContain("threadRef={threadRef}");
  });

  it("keeps memory and chat bound to the chat the user picked", () => {
    expect(
      resolveBotThreadTarget(
        "bot-1",
        "env-1",
        [
          {
            environmentId: "env-1",
            id: "thread-selected",
            botId: "bot-1",
            updatedAt: "2026-08-30T00:00:00.000Z",
            archivedAt: null,
            deletedAt: null,
          },
          {
            environmentId: "env-1",
            id: "thread-newer",
            botId: "bot-1",
            updatedAt: "2026-08-31T00:00:00.000Z",
            archivedAt: null,
            deletedAt: null,
          },
        ],
        "/env-1/thread-selected",
      ),
    ).toMatchObject({ threadId: ThreadId.make("thread-selected") });

    expect(EnvironmentId.make("env-1")).toBe("env-1");

    const runtime = NodeFS.readFileSync(
      new URL("./useBotThreadRuntime.ts", import.meta.url),
      "utf8",
    );

    expect(runtime).toContain("resolveBotThreadTarget(");
  });
});
