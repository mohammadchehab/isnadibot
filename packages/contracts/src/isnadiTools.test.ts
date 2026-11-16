import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
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
      // `<<` in an arithmetic region is a shift operator, not an opener.
      ["echo $((1 << n))", "rm -rf /tmp/x", "n", "delete"],
      ["echo $((a << b))", "rm -rf /tmp/x", "b", "delete"],
      ["echo $[1<<k]", "rm -rf /tmp/x", "k", "delete"],
      ["(( total = 1 << bits ))", "git push origin main", "bits", "production"],
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

/**
 * Regions this scanner does not read. Each one hides a `<<` from the shell and
 * shows it to a scanner that reads the line as plain shell text, so the body it
 * "opens" is deleted before classification and the command inside runs with no
 * prompt. The list cannot be finished — that is the point of the rule — so the
 * scanner strips nothing at all when it meets one.
 */
describe("Shell command intent outside the modelled subset", () => {
  const lines = (...parts: ReadonlyArray<string>) => parts.join("\n");

  const shapes = [
    // `${…}` parameter expansion: the `<<EOF` is part of the expansion's word.
    ["parameter expansion ${x:-<<EOF}", "echo ${x:-<<EOF}"],
    // `$'…'` ANSI-C quoting: `\'` is an escaped quote, so bash keeps the string
    // open across the `<<` the scanner reads as an operator.
    ["ANSI-C quoting $'a\\'b <<EOF'", "$'a\\'b <<EOF'"],
    // Backticks are command substitution, a region the scanner never enters.
    ["backtick substitution", "echo `cat <<EOF`"],
    // `$(…)` command substitution is the same region in its other spelling.
    ["command substitution $(…)", "echo $(cat <<EOF)"],
    // `$"…"` is locale quoting, read like `"…"` by the shell.
    ['locale quoting $"…"', 'echo $"see <<EOF"'],
    // A `<<` whose delimiter is not a literal word has no terminator to find.
    ["a delimiter the shell expands", "cat > f <<$DELIM"],
    // A trailing backslash continues the line, so the next line is not a command.
    ["a continued line", "echo one \\"],
    // An array assignment: the shell rejects the `<<` inside `(…)` as a syntax
    // error, keeps going, and runs the next line.
    ["an array assignment a=(…)", "a=(<<EOF)"],
    // An extglob pattern: `@(…)`, and `+(…)`, `!(…)`, `?(…)`, `*(…)` with it,
    // are pattern lists where a `<<` is not an operator.
    ["an extglob case pattern @(…)", "case x in @(<<EOF)) ;; esac"],
    // An array subscript is an arithmetic context without the `$`: the shell
    // expands `a[1<<B]` as a shift, reports `B: command not found`, and runs
    // the next line. The delimiter is the shift's right operand, not `EOF`.
    ["an array subscript a[1<<B]", "a[1<<B]=x", "B"],
    ["an array subscript with a name", "a[i<<D]=x", "D"],
    ["an array subscript with spaces", "a[1 << B]=x", "B"],
    ["an array subscript append", "a[1<<B]+=x", "B"],
    ["an integer array subscript", lines("declare -i a", "a[1<<B]=1"), "B"],
  ] as const;

  it("strips nothing when it meets a construct it does not model", () => {
    for (const [name, openerLine, delimiter] of shapes) {
      const command = lines(openerLine, "rm -rf /tmp/x", delimiter ?? "EOF");

      expect(classifyIsnadiExternalCommand(command), name).toBe("delete");
      // Nothing was stripped, so the destructive line is still there to be read.
      expect(stripHeredocBodies(command), name).toBe(command);
    }
  });

  it("makes the tool ask for approval, so the shell cannot run unapproved", () => {
    // `localFullAccess` with a command present skips ExternalShell's own
    // `user-computer` approval, which leaves the classifier as the only gate.
    // Shell's own class is `none`, so on a cloud workspace it has no other gate
    // either.
    const externalShell = ISNADI_TOOL_CATALOG.find(
      (candidate) => candidate.id === "ExternalShell",
    )!;

    const cloudShell = ISNADI_TOOL_CATALOG.find((candidate) => candidate.id === "Shell")!;

    for (const [name, openerLine, delimiter] of shapes) {
      const command = lines(openerLine, "rm -rf /tmp/x", delimiter ?? "EOF");

      expect(isnadiToolApprovalForInput(externalShell, { command }), name).toBe("delete");
      expect(
        isnadiToolRequiresApproval(externalShell, { localFullAccess: true }, { command }),
        name,
      ).toBe(true);

      expect(isnadiToolApprovalForInput(cloudShell, { command }), name).toBe("delete");
      expect(
        isnadiToolRequiresApproval(cloudShell, { localFullAccess: false }, { command }),
        name,
      ).toBe(true);
    }
  });

  it("strips nothing when a quote is still open at the end of the command", () => {
    const command = lines("echo 'unterminated", "rm -rf /tmp/x");

    expect(stripHeredocBodies(command)).toBe(command);
    expect(classifyIsnadiExternalCommand(command)).toBe("delete");
  });

  it("still strips a body that names the constructs it refuses to read as shell", () => {
    // These regions are ordinary content in a heredoc body, and a body is never
    // scanned: refusing to read them must not cost the feature its main case.
    const command = lines(
      "cat > f.ts <<'EOF'",
      "const id = `${environment}:${id}`;",
      "const out = $'a\\'b';",
      "echo `cat <<EOF`",
      "rm -rf /tmp/x",
      "EOF",
    );

    expect(stripHeredocBodies(command)).toBe("cat > f.ts <<'EOF'");
    expect(classifyIsnadiExternalCommand(command)).toBeUndefined();
  });
});

describe("Shell command intent inside an arithmetic region", () => {
  const lines = (...parts: ReadonlyArray<string>) => parts.join("\n");

  /**
   * Shapes where a `<<` the shell reads as a shift was read back as a heredoc
   * opener, so the destructive line after it was stripped as body and nothing
   * was classified. Two conditions make a shape bite, and both must hold: the
   * misread delimiter has to be a word, because `HEREDOC_DELIMITER` starts with
   * a letter, and a later line equal to it has to exist, or the heredoc is
   * unterminated and `stripHeredocBodies` leaves everything alone.
   */
  const shapes = [
    // The first `]` is `a[1]`'s, not the region's, so the region ended early and
    // the `<< k` after it read as an opener.
    ["nested subscript $[ a[1] << k ]", ["echo $[ a[1] << k ]"], "k"],
    ["$[a[0]<<k]", ["echo $[a[0]<<k]"], "k"],
    // The region opens on one line and closes on a later one, so a scanner that
    // reads one line at a time never sees it as arithmetic at all.
    ["$(( opened on its own line", ["echo $((", "1 << n", "))"], "n"],
    ["(( opened on its own line", ["((", "1 << n", "))"], "n"],
    ["$[ opened on its own line", ["echo $[", "1 << k", "]"], "k"],
  ] as const;

  it("keeps the destructive line after a shift, in every shape", () => {
    for (const [name, prefix, delimiter] of shapes) {
      const command = lines(...prefix, "rm -rf /tmp/x", delimiter);

      expect(classifyIsnadiExternalCommand(command), name).toBe("delete");
      // Nothing was stripped: the destructive line is still there to be read.
      expect(stripHeredocBodies(command), name).toBe(command);
    }
  });

  it("makes the tool ask for approval, so the shell cannot run unapproved", () => {
    // `localFullAccess` with a command present skips ExternalShell's own
    // `user-computer` approval, which leaves the classifier as the only gate.
    // Returning no class there is the bypass: approval is then not required.
    const tool = ISNADI_TOOL_CATALOG.find((candidate) => candidate.id === "ExternalShell")!;
    const command = lines("echo $((", "1 << n", "))", "rm -rf /tmp/x", "n");

    expect(isnadiToolApprovalForInput(tool, { command })).toBe("delete");
    expect(isnadiToolRequiresApproval(tool, { localFullAccess: true }, { command })).toBe(true);
  });

  it("carries a paren region across lines so its second line never opens a heredoc", () => {
    const command = lines("echo $((", "1 << n", "))", "rm -rf /tmp/x", "n");

    expect(stripHeredocBodies(command)).toBe(command);
    expect(classifyIsnadiExternalCommand(command)).toBe("delete");
  });

  it("carries a bracket region's depth, so a subscript inside it does not close it", () => {
    const command = lines("echo $[", "a[1] << k", "]", "rm -rf /tmp/x", "k");

    expect(stripHeredocBodies(command)).toBe(command);
    expect(classifyIsnadiExternalCommand(command)).toBe("delete");
  });

  it("still strips a real heredoc opened after the carried region closes", () => {
    const command = lines("echo $((", "1 << n", ")); cat > f.txt <<EOF", "rm -rf /tmp/x", "EOF");

    expect(stripHeredocBodies(command)).toBe(lines("echo $((", "1 << n", ")); cat > f.txt <<EOF"));
    expect(classifyIsnadiExternalCommand(command)).toBeUndefined();
  });

  it("keeps every later line inside a region that never closes", () => {
    // An unterminated region is a shell syntax error, so the command cannot run
    // anyway; keeping the text is the fail-closed side of the same choice an
    // unterminated heredoc gets.
    const command = lines("echo $((", "1 << n", "rm -rf /tmp/x");

    expect(classifyIsnadiExternalCommand(command)).toBe("delete");
  });
});

/**
 * The credential filenames a security review measured the old denylist missing
 * on main (TASK-382), as named in the review. Each one classifies as `secrets`,
 * which is what makes a delegated read of it refuse instead of run: a `none`
 * ceiling covers nothing above `user-computer`, so the classifier is the gate.
 */
const CREDENTIAL_PATHS = [
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".git-credentials",
  ".docker/config.json",
  ".kube/config",
  "id_rsa",
  "key.pem",
  "server.key",
  ".terraform/credentials.tfrc.json",
  ".pgpass",
  ".my.cnf",
  ".vault-token",
  "adc.json",
  "service-account.json",
  "terraform.tfstate",
  ".htpasswd",
  "credentials.json",
  "secrets.yaml",
  "token.txt",
] as const;

describe("Sensitive path classification", () => {
  const read = ISNADI_TOOL_CATALOG.find((tool) => tool.id === "ExternalRead")!;

  it.each(CREDENTIAL_PATHS)("refuses a read of %s", (path) => {
    expect(isnadiToolApprovalForInput(read, { path })).toBe("secrets");
    expect(isnadiToolRequiresApproval(read, { localFullAccess: true }, { path })).toBe(true);
  });

  it("refuses a credential name that is a folder, not the basename", () => {
    // A rule that reads only the last segment misses all four of these.
    for (const path of [
      "/home/me/project/.docker/config.json",
      "/home/me/.kube/config",
      "/home/me/project/.terraform/terraform.tfstate",
      "/home/me/project/.git/config",
    ]) {
      expect(isnadiToolApprovalForInput(read, { path })).toBe("secrets");
    }
  });

  it("refuses a credential folder that is not hidden", () => {
    for (const path of ["/home/me/credentials/aws.txt", "/home/me/secrets/prod.yaml"]) {
      expect(isnadiToolApprovalForInput(read, { path })).toBe("secrets");
    }
  });

  it("still auto-approves ordinary source in the same folder", () => {
    for (const path of [
      "/home/me/project/src/index.ts",
      "/home/me/project/package.json",
      "/home/me/project/README.md",
      "./README.md",
      "../notes.md",
      "C:\\Users\\me\\project\\notes.md",
    ]) {
      expect(isnadiToolApprovalForInput(read, { path })).toBe("user-computer");
      expect(isnadiToolRequiresApproval(read, { localFullAccess: true }, { path })).toBe(false);
    }
  });
});
