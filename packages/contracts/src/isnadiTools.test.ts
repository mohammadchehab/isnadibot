import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import { describe, expect, it } from "vite-plus/test";

import {
  ISNADI_DELEGATION_CONTEXT_MAX_CHARS,
  ISNADI_TOOL_CATALOG,
  IsnadiToolInputSchemas,
  IsnadiToolReceipt,
  isnadiToolApprovalForInput,
  isnadiToolRequiresApproval,
  copyDirectionForTool,
  decodeIsnadiToolInput,
  filterIsnadiTools,
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
 * The guard reads every field a tool input can reach, at any depth, so a home
 * nested in a target struct, a list element or a union member still fails here.
 * A shape the guard cannot read fails it too, because an unread shape cannot be
 * proven free of a home.
 *
 * A future tool that could name a home fails here rather than at the boundary.
 */
describe("Isnadi tool catalog writes no bot home", () => {
  it("gives no tool an input field that names a home", () => {
    const namingAHome = ISNADI_TOOL_CATALOG.filter((tool) =>
      namesABotHome(IsnadiToolInputSchemas[tool.id]),
    ).map((tool) => tool.id);

    expect(namingAHome).toEqual([]);
  });

  it("reads every tool's input, so an unreadable shape cannot hide one", () => {
    const unreadable = ISNADI_TOOL_CATALOG.filter(
      (tool) => walkInputFields(IsnadiToolInputSchemas[tool.id]).unreadable.length > 0,
    ).map((tool) => tool.id);

    expect(unreadable).toEqual([]);
  });
});

describe("The bot home guard reads nested shapes", () => {
  it("finds a home behind a nested target struct", () => {
    const nested = Schema.Struct({
      target: Schema.Struct({ groupId: Schema.String }),
    });

    expect(namesABotHome(nested)).toBe(true);
  });

  it("finds a home inside a list element and an optional field", () => {
    const listed = Schema.Struct({
      targets: Schema.Array(Schema.Struct({ groupId: Schema.String })),
    });

    const optional = Schema.Struct({
      target: Schema.optional(Schema.Struct({ groupId: Schema.String })),
    });

    expect(namesABotHome(listed)).toBe(true);
    expect(namesABotHome(optional)).toBe(true);
  });
  it("finds a home behind a suspended schema", () => {
    const suspended: Schema.Top = Schema.suspend(() =>
      Schema.Struct({
        child: Schema.optional(suspended),
        groupId: Schema.optional(Schema.String),
      }),
    );

    expect(namesABotHome(suspended)).toBe(true);
  });

  it("fails on a union member it cannot read instead of skipping it", () => {
    const hiding = Schema.Union([Schema.Struct({ name: Schema.String }), Schema.Unknown]);

    expect(walkInputFields(hiding).unreadable).toEqual(["Unknown"]);
  });

  it("reads an ordinary input without calling it unreadable", () => {
    const plain = Schema.Struct({ name: Schema.String, count: Schema.Number });

    expect(walkInputFields(plain)).toEqual({
      paths: ["name", "count"],
      unreadable: [],
    });
  });
});

/** Whether a tool input can name a bot home at any depth. */
function namesABotHome(schema: Schema.Top): boolean {
  return walkInputFields(schema).paths.some((path) => path.split(".").includes("groupId"));
}

type AstNode = SchemaAST.AST;

/**
 * AST tags that carry no fields of their own. A leaf is readable: it is known
 * to hold no name, so it never counts as an unread shape.
 */
const LEAF_AST_TAGS: ReadonlySet<string> = new Set([
  "BigInt",
  "Boolean",
  "Enum",
  "Literal",
  "Never",
  "Null",
  "Number",
  "ObjectKeyword",
  "String",
  "Symbol",
  "TemplateLiteral",
  "Undefined",
  "UniqueSymbol",
  "Void",
]);

type InputFieldWalk = {
  /** Dotted path of every field read, with `[]` marking an array element. */
  readonly paths: ReadonlyArray<string>;
  /** Tags of shapes the walk could not see into. */
  readonly unreadable: ReadonlyArray<string>;
};

/**
 * Every field a tool input can reach, at any depth, plus the shapes the walk
 * could not read. Effect schemas are class instances whose shapes live on
 * `.ast`, so this walks the AST rather than the schema.
 */
function walkInputFields(schema: Schema.Top): InputFieldWalk {
  const paths: string[] = [];
  const unreadable: string[] = [];
  // A suspended schema can refer to itself, so each node is read once.
  const visited = new Set<AstNode>();

  const walk = (node: AstNode, prefix: string): void => {
    if (visited.has(node)) {
      return;
    }

    visited.add(node);

    if (LEAF_AST_TAGS.has(node._tag)) {
      return;
    }

    if (SchemaAST.isObjects(node)) {
      walkObjectFields(node, prefix, paths, walk);

      return;
    }

    if (SchemaAST.isArrays(node)) {
      for (const element of [...node.elements, ...node.rest]) {
        walk(element, `${prefix}[]`);
      }

      return;
    }

    if (SchemaAST.isUnion(node)) {
      for (const member of node.types) {
        walk(member, prefix);
      }

      return;
    }

    if (SchemaAST.isSuspend(node)) {
      walk(node.thunk(), prefix);

      return;
    }

    if (SchemaAST.isDeclaration(node) && node.typeParameters.length > 0) {
      for (const parameter of node.typeParameters) {
        walk(parameter, prefix);
      }

      return;
    }

    unreadable.push(node._tag);
  };

  walk(schema.ast, "");

  return { paths, unreadable };
}

/** Records a struct's own fields, then reads each field's shape. */
function walkObjectFields(
  node: SchemaAST.Objects,
  prefix: string,
  paths: string[],
  walk: (node: AstNode, prefix: string) => void,
): void {
  for (const signature of node.propertySignatures) {
    const path = prefix === "" ? String(signature.name) : `${prefix}.${String(signature.name)}`;

    paths.push(path);
    walk(signature.type, path);
  }

  for (const signature of node.indexSignatures) {
    walk(signature.type, `${prefix}[*]`);
  }
}
