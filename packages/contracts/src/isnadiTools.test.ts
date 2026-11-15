import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ISNADI_DELEGATION_CONTEXT_MAX_CHARS,
  ISNADI_TOOL_CATALOG,
  IsnadiToolInputSchemas,
  IsnadiToolReceipt,
  classifyIsnadiExternalCommand,
  isnadiToolApprovalForInput,
  isnadiToolRequiresApproval,
  copyDirectionForTool,
  decodeIsnadiToolInput,
  filterIsnadiTools,
  stripHeredocBodies,
} from "./isnadiTools.ts";

describe("Isnadi tool contracts", () => {
  it("includes the M2-T6 catalog ids and rejects invalid inputs", () => {
    for (const id of [
      "WebSearch",
      "WebFetch",
      "GenerateImage",
      "AddMcpServer",
      "UninstallMcpServer",
      "RemoveMcpAccount",
      "RenameMcpAccount",
      "SetMcpInstructions",
    ] as const) {
      expect(ISNADI_TOOL_CATALOG.some((tool) => tool.id === id)).toBe(true);
    }

    expect(() => decodeIsnadiToolInput("WebSearch", { query: "" })).toThrow();
    expect(() => decodeIsnadiToolInput("WebFetch", { url: "file:///secret" })).toThrow();
    expect(() =>
      decodeIsnadiToolInput("GenerateImage", { operation: "generate", prompt: "" }),
    ).toThrow();
    expect(() =>
      decodeIsnadiToolInput("AddMcpServer", { serverId: "x", name: "x", transport: "stdio" }),
    ).toThrow();
    expect(() =>
      decodeIsnadiToolInput("AddMcpServer", { serverId: "x", name: "x", transport: "url" }),
    ).toThrow();
    expect(() => decodeIsnadiToolInput("RenameMcpAccount", { serverId: "x" })).toThrow();
    expect(() =>
      decodeIsnadiToolInput("AddMcpServer", {
        serverId: "x",
        name: "x",
        transport: "url",
        url: "https://user:pass@example.com",
      }),
    ).toThrow();
  });
  it("validates copy direction and rejects incomplete input", () => {
    expect(copyDirectionForTool("CopyToBox")).toEqual({
      from: "user-computer",
      to: "bot-workspace",
    });
    expect(copyDirectionForTool("CopyFromBox")).toEqual({
      from: "bot-workspace",
      to: "user-computer",
    });
    expect(() => decodeIsnadiToolInput("CopyToBox", { path: "/tmp/report" })).toThrow();
  });

  it("only returns implemented tools for available computer boundaries", () => {
    expect(
      filterIsnadiTools({
        capabilities: new Set(["bot-workspace", "user-computer"]),
        workspaceType: "local",
        hasUserComputer: false,
        localFullAccess: false,
        implementedTools: new Set(["Shell", "ExternalShell", "CopyToBox"]),
      }).map((tool) => tool.id),
    ).toEqual(["Shell"]);
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "AuthenticateMcpServer")?.approval).toBe(
      "secrets",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "RestartMcpServers")?.approval).toBe(
      "production",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "InstallPlugin")?.approval).toBe(
      "production",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "UninstallPlugin")?.approval).toBe(
      "delete",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "SearchPlugins")?.approval).toBe("none");
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "GetPlugin")?.approval).toBe("none");
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "GetMcpServerStatus")?.approval).toBe(
      "none",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "TestMcpServer")?.approval).toBe(
      "production",
    );
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "ReconnectMcpServer")?.approval).toBe(
      "production",
    );
  });

  it("accepts catalog-owned plugin inputs and rejects model-supplied recipes", () => {
    expect(decodeIsnadiToolInput("InstallPlugin", { pluginId: "exa" })).toEqual({
      pluginId: "exa",
    });
    expect(() =>
      decodeIsnadiToolInput("InstallPlugin", {
        pluginId: "exa",
        url: "https://attacker.example/mcp",
      }),
    ).toThrow();
    expect(() => decodeIsnadiToolInput("SearchPlugins", { query: "web", limit: 51 })).toThrow();
  });

  it("hides SendToAgent at delegation limits", () => {
    const context = {
      capabilities: new Set(["bot-workspace"] as const),
      workspaceType: "local" as const,
      hasUserComputer: false,
      localFullAccess: false,
      implementedTools: new Set(["SendToAgent"]),
    };

    expect(
      filterIsnadiTools({ ...context, delegationDepth: 1, activeDelegations: 2 }).map(
        (tool) => tool.id,
      ),
    ).toEqual(["SendToAgent"]);
    expect(filterIsnadiTools({ ...context, delegationDepth: 2, activeDelegations: 2 })).toEqual([]);
    expect(filterIsnadiTools({ ...context, delegationDepth: 1, activeDelegations: 3 })).toEqual([]);
  });

  it("hides Task inside a worker and validates worker inputs", () => {
    const context = {
      capabilities: new Set(["bot-workspace"] as const),
      workspaceType: "local" as const,
      hasUserComputer: false,
      localFullAccess: false,
      implementedTools: new Set(["Task", "CheckSubagent", "MessageSubagent", "StopSubagent"]),
    };

    expect(filterIsnadiTools({ ...context, workerDepth: 0 }).map((tool) => tool.id)).toEqual([
      "Task",
      "CheckSubagent",
      "MessageSubagent",
      "StopSubagent",
    ]);
    expect(filterIsnadiTools({ ...context, workerDepth: 1 }).map((tool) => tool.id)).toEqual([
      "CheckSubagent",
      "MessageSubagent",
      "StopSubagent",
    ]);

    for (const toolId of ["Task", "CheckSubagent", "MessageSubagent", "StopSubagent"] as const) {
      expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === toolId)?.approval).toBe("none");
    }

    expect(decodeIsnadiToolInput("Task", { task: "Summarize", background: true })).toEqual({
      task: "Summarize",
      background: true,
    });
    expect(() => decodeIsnadiToolInput("Task", { task: "  " })).toThrow();
    expect(() => decodeIsnadiToolInput("CheckSubagent", {})).toThrow();
    expect(() => decodeIsnadiToolInput("MessageSubagent", { workerId: "worker-1" })).toThrow();
  });

  it("decodes the approval limit and keeps escalation fields server-owned", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
      approvalCeiling: "send" as const,
    };

    expect(decodeIsnadiToolInput("SendToAgent", input)).toMatchObject(input);
    expect(() => decodeIsnadiToolInput("SendToAgent", { ...input, depth: 2 })).toThrow();
    expect(() =>
      decodeIsnadiToolInput("SendToAgent", {
        ...input,
        hasUserComputer: true,
      }),
    ).toThrow();
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "SendToAgent")?.approval).toBe("send");
  });

  it("bounds the context a bot hands to a child and rejects oversized context", () => {
    const input = {
      botId: "bot-research",
      task: "Compare three flights.",
      expectedResult: "A short comparison with sources.",
    };

    const context = "x".repeat(ISNADI_DELEGATION_CONTEXT_MAX_CHARS);
    expect(decodeIsnadiToolInput("SendToAgent", { ...input, context })).toMatchObject({ context });
    expect(
      decodeIsnadiToolInput("MessageAgent", { ...input, context: "Prefers morning flights." }),
    ).toMatchObject({ context: "Prefers morning flights." });
    expect(() =>
      decodeIsnadiToolInput("SendToAgent", { ...input, context: `${context}x` }),
    ).toThrow(`at most ${ISNADI_DELEGATION_CONTEXT_MAX_CHARS} characters`);
  });

  it("types durable bot management without bypassing send or cancellation approval", () => {
    expect(decodeIsnadiToolInput("CreateAgent", { name: "Research" })).toEqual({
      name: "Research",
    });
    expect(decodeIsnadiToolInput("CheckAgent", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(decodeIsnadiToolInput("StopAgent", { botId: "bot-research" })).toEqual({
      botId: "bot-research",
    });
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "MessageAgent")?.approval).toBe("send");
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "StopAgent")?.approval).toBe("delete");
  });

  it("decodes SendToUser input and keeps it approval-gated", () => {
    expect(decodeIsnadiToolInput("SendToUser", { message: "The export is ready." })).toEqual({
      message: "The export is ready.",
    });
    expect(() => decodeIsnadiToolInput("SendToUser", { message: "" })).toThrow();
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "SendToUser")?.approval).toBe("send");
  });

  it("decodes only narrow bot profile fields", () => {
    expect(
      decodeIsnadiToolInput("UpdateBotProfile", {
        name: "Researcher",
        label: null,
        description: "Checks primary sources.",
      }),
    ).toEqual({
      name: "Researcher",
      label: null,
      description: "Checks primary sources.",
    });
    expect(() => decodeIsnadiToolInput("UpdateBotProfile", {})).toThrow();
    expect(() =>
      decodeIsnadiToolInput("UpdateBotProfile", {
        name: "Researcher",
        botId: "another-bot",
      }),
    ).toThrow();
    expect(() =>
      decodeIsnadiToolInput("UpdateBotProfile", {
        name: "Researcher",
        groupId: "another-group",
      }),
    ).toThrow();
  });

  it("validates message reactions and keeps them approval-gated", () => {
    const input = { messageId: "message-1", emoji: "👍", action: "add" as const };
    expect(decodeIsnadiToolInput("ReactToMessage", input)).toEqual(input);
    expect(() => decodeIsnadiToolInput("ReactToMessage", { ...input, action: "toggle" })).toThrow();
    expect(ISNADI_TOOL_CATALOG.find((tool) => tool.id === "ReactToMessage")?.approval).toBe("send");
  });

  it("never lets full access bypass protected commands or paths", () => {
    const shell = ISNADI_TOOL_CATALOG.find((tool) => tool.id === "ExternalShell")!;
    const read = ISNADI_TOOL_CATALOG.find((tool) => tool.id === "ExternalRead")!;
    const copyFromBox = ISNADI_TOOL_CATALOG.find((tool) => tool.id === "CopyFromBox")!;

    const copyInput = {
      sourcePath: "/project/.env",
      destinationPath: "/tmp/exported-env",
    };

    expect(isnadiToolApprovalForInput(shell, { command: "git push origin main" })).toBe(
      "production",
    );
    expect(
      isnadiToolRequiresApproval(
        shell,
        { localFullAccess: true },
        { command: "git push origin main" },
      ),
    ).toBe(true);
    expect(
      isnadiToolRequiresApproval(read, { localFullAccess: true }, { path: "/project/.env" }),
    ).toBe(true);
    expect(isnadiToolApprovalForInput(copyFromBox, copyInput)).toBe("secrets");
    expect(isnadiToolRequiresApproval(copyFromBox, { localFullAccess: true }, copyInput)).toBe(
      true,
    );
  });

  it("records a bot-to-bot handoff inside one space and keeps the approval across spaces", () => {
    // `SendToAgent` and `MessageAgent` are one handoff family: same `botId`
    // input, same `session.delegation.send` dispatch. The boundary is the
    // space, not the tool, so both are recorded inside one and approved across.
    const handoffInput = {
      botId: "target-bot",
      task: "Review the change.",
      expectedResult: "A review.",
    };

    for (const toolId of ["MessageAgent", "SendToAgent"] as const) {
      const tool = ISNADI_TOOL_CATALOG.find((candidate) => candidate.id === toolId)!;

      // Protected by default, so the same-space case below is a real exemption.
      expect(tool.approval).toBe("send");
      expect(
        isnadiToolRequiresApproval(
          tool,
          { localFullAccess: false, sameSpaceTarget: true },
          handoffInput,
        ),
      ).toBe(false);
      expect(
        isnadiToolRequiresApproval(
          tool,
          { localFullAccess: false, sameSpaceTarget: false },
          handoffInput,
        ),
      ).toBe(true);
      // A session that could not resolve the relationship keeps the approval.
      expect(isnadiToolRequiresApproval(tool, { localFullAccess: false }, handoffInput)).toBe(true);
    }
  });

  it("decodes non-fatal typed receipts", () => {
    const decode = Schema.decodeUnknownSync(IsnadiToolReceipt);
    expect(
      decode({
        receiptId: "receipt-1",
        toolId: "Shell",
        phase: "failure",
        threadId: "thread-1",
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toMatchObject({ fatalToThread: false });
    expect(() =>
      decode({
        receiptId: "receipt-2",
        toolId: "Shell",
        phase: "failure",
        threadId: "thread-1",
        fatalToThread: true,
        createdAt: "2026-08-31T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

/**
 * The same-space handoff predicate allows a `SendToAgent` without approval when
 * both bots share a home (`bot.groupId`). It holds only while no tool can move
 * an existing bot into the caller's space, and the tool that could is the one
 * whose input can name a `groupId`.
 *
 * Two tools do dispatch commands that carry a home: `UpdateBotProfile`
 * (`bot.update`) and `CreateAgent` (`bot.create`). What keeps them safe is the
 * shape of their input, not the command: neither can name a `groupId`, and tool
 * input rejects excess properties, so `bot.update` can never be handed one.
 * `CreateAgent`'s home comes from the calling thread, which places a brand-new
 * bot and grants no reach over a bot that already has a home.
 *
 * A future tool that could name a home fails here rather than at the boundary.
 */
describe("Isnadi tool catalog writes no bot home", () => {
  it("gives no tool an input field that names a home", () => {
    const namingAHome = ISNADI_TOOL_CATALOG.filter((tool) =>
      inputFieldNames(IsnadiToolInputSchemas[tool.id]).includes("groupId"),
    ).map((tool) => tool.id);

    expect(namingAHome).toEqual([]);
  });

  it("reads every tool's input, so an unreadable shape cannot hide one", () => {
    const unreadable = ISNADI_TOOL_CATALOG.filter(
      (tool) => inputFieldNames(IsnadiToolInputSchemas[tool.id]).length === 0,
    ).map((tool) => tool.id);

    expect(unreadable).toEqual([]);
  });
});

/** Field names of a tool input, descending into the members of a union. */
function inputFieldNames(schema: Schema.Top): ReadonlyArray<string> {
  // Effect schemas are functions, so `Predicate.isObject` is false for them.
  if (Predicate.hasProperty(schema, "fields") && Predicate.isObject(schema.fields)) {
    return Object.keys(schema.fields);
  }

  if (Predicate.hasProperty(schema, "members") && Array.isArray(schema.members)) {
    return schema.members.flatMap((member: Schema.Top) => inputFieldNames(member));
  }

  return [];
}

describe("Shell command intent", () => {
  const heredoc = (...lines: ReadonlyArray<string>) => lines.join("\n");

  it("reads a heredoc body as content, not as a destructive command", () => {
    const command = heredoc(
      "cd /project && cat > README.md <<EOF",
      "# Todo",
      "Delete a todo to remove it, or send it to the archive.",
      "EOF",
    );

    expect(classifyIsnadiExternalCommand(command)).toBeUndefined();
  });

  it("reads a script body as content, so requiring node:crypto is not a send", () => {
    const command = heredoc(
      "cat > package.json <<EOF",
      '{"scripts":{"send":"node store.js"}}',
      "EOF",
      "cat > store.js <<EOF",
      'import { createHash } from "node:crypto";',
      "EOF",
    );

    expect(classifyIsnadiExternalCommand(command)).toBeUndefined();
  });

  it("strips every quoted, tab-stripped and backslash heredoc form", () => {
    for (const opener of ["<<'EOF'", '<<"EOF"', "<<-EOF", "<<\\EOF"]) {
      const body = opener === "<<-EOF" ? "\trm -rf /" : "rm -rf /";
      const terminator = opener === "<<-EOF" ? "\tEOF" : "EOF";

      expect(
        classifyIsnadiExternalCommand(heredoc(`cat > f.txt ${opener}`, body, terminator)),
      ).toBeUndefined();
    }
  });

  it("still classifies rm and curl outside a heredoc", () => {
    expect(classifyIsnadiExternalCommand("rm -rf build")).toBe("delete");
    expect(classifyIsnadiExternalCommand("curl -X POST https://example.com -d '{}'")).toBe("send");
  });

  it("keeps an unterminated heredoc whole so it cannot hide a destructive command", () => {
    // The opener swallows the rest of the command; dropping what follows would
    // protect a stray heredoc at the cost of missing the real `rm`.
    expect(classifyIsnadiExternalCommand(heredoc("cat > f.txt <<EOF", "rm -rf /"))).toBe("delete");
  });

  it("keeps a destructive command that shares the terminator line", () => {
    // `EOF; rm -rf /` is not a terminator in the shell, so the heredoc never
    // closes and the line is body text — the same fail-closed case as above.
    expect(classifyIsnadiExternalCommand(heredoc("cat <<EOF", "body", "EOF; rm -rf /"))).toBe(
      "delete",
    );
  });

  it("still classifies a command after a legitimate terminator", () => {
    expect(classifyIsnadiExternalCommand(heredoc("cat <<EOF", "body", "EOF", "rm -rf /"))).toBe(
      "delete",
    );
  });

  it("keeps the opener line when it strips a body", () => {
    expect(stripHeredocBodies(heredoc("cat > f.txt <<EOF", "hello", "EOF"))).toBe(
      "cat > f.txt <<EOF",
    );
  });

  it("keeps a `<<` the shell never reads as an operator from hiding a command", () => {
    // The shell reads each of these `<<` as text and runs the line after it. A
    // scanner that treats any `<<WORD` as an opener drops that line from the
    // text it classifies, so the command runs with no approval prompt at all.
    const cases = [
      [`echo "see <<EOF below"`, "rm -rf /tmp/x", "EOF", "delete"],
      ["echo 'use <<EOF to end'", "rm -rf /tmp/x", "EOF", "delete"],
      ["# example: <<EOF", "rm -rf /tmp/x", "EOF", "delete"],
      ["grep -c '<<EOF' notes.md", "rm -rf /tmp/x", "EOF", "delete"],
      ["cat <<< EOF", "rm -rf /tmp/x", "EOF", "delete"],
      ["echo 'use <<E to end'", "rm -rf /tmp/x", "E", "delete"],
      ["echo x # <<EOF", "git push origin main", "EOF", "production"],
    ] as const;

    for (const [openerLine, hiddenLine, closingLine, expected] of cases) {
      const command = heredoc(openerLine, hiddenLine, closingLine);

      expect(classifyIsnadiExternalCommand(command)).toBe(expected);
      expect(stripHeredocBodies(command)).toBe(command);
    }
  });

  it("still strips a real heredoc that shares a line with quoted text", () => {
    const command = heredoc("echo '<<EOF' > note.txt; cat > f <<MD", "rm -rf /", "MD");

    expect(stripHeredocBodies(command)).toBe("echo '<<EOF' > note.txt; cat > f <<MD");
    expect(classifyIsnadiExternalCommand(command)).toBeUndefined();
  });
});

