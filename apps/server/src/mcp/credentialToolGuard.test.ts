import { ISNADI_TOOL_CATALOG } from "@isnadi/contracts";
import { describe, expect, it } from "@effect/vitest";
import { NodeServices } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { McpServer } from "effect/unstable/ai";

import { TestLayer } from "./testUtils/mcpHttpServer.ts";

/**
 * TASK-29.1 AC7: the credential vault is not reachable from a tool surface a bot drives.
 *
 * The vault's write half (`vault/SecretVault.ts`: set, replace, delete, list) and its broker-only
 * reader (`vault/requestSecret.ts`: withSecret) are owner-only. The RPCs that expose them require
 * `access:write`, which no bot token and no provider session carries. A tool on `/mcp` or in a bot
 * tool catalog would carry no such check, so it must not exist: this test fails the day one is
 * added and names it.
 *
 * Both enumerations are live — `/mcp` tools come from the running server service, the bot catalog
 * from the contract the providers read — so a new tool appears here without anyone editing a list.
 */

/**
 * A tool name that offers credential work. Deliberately broad: `credential_save` or `vault_write`
 * must fail here even though neither exists. `AuthenticateMcpServer` and `RemoveMcpAccount` name a
 * connected account's login, not a secret the vault stores, and do not match.
 */
const CREDENTIAL_TOOL_NAME = /credential|vault|secret|password/i;

/**
 * The vault directory is closed to both tool surfaces. The one module a provider layer may import
 * is `masterKeyEnv.ts`, which strips the master key from a child process environment and cannot
 * read a secret; anything else under `vault/` would put secret material behind a bot-driven tool.
 */
const VAULT_MODULE = /(^|\/)vault\//;

const ALLOWED_VAULT_IMPORT = /(^|\/)vault\/masterKeyEnv\.ts$/;

/** Import specifiers from `import … from "x"`, `import "x"` and `import("x")`. */
const QUOTED_IMPORT = /(?:from|import)\s*\(?\s*"([^"]+)"/g;

const importedSpecifiers = (source: string): ReadonlyArray<string> =>
  Array.from(source.matchAll(QUOTED_IMPORT), (match) => match[1]).filter(
    (specifier): specifier is string => specifier !== undefined,
  );

const isVaultImport = (specifier: string) =>
  VAULT_MODULE.test(specifier) && !ALLOWED_VAULT_IMPORT.test(specifier);

/** The `tool.name` of every tool the running MCP server would answer `tools/list` with. */
const registeredMcpToolNames = Effect.gen(function* () {
  const server = yield* McpServer.McpServer;

  return server.tools.map(({ tool }) => tool.name);
});

describe("the tool surfaces a bot can drive", () => {
  it.effect("register no credential-writing tool on /mcp", () =>
    Effect.gen(function* () {
      const names = yield* registeredMcpToolNames;

      // Guards the guard: a registration that stopped running would leave every assertion below
      // true for the wrong reason.
      expect(names.length).toBeGreaterThan(1);
      expect(names).toContain("memory");

      expect(names.filter((name) => CREDENTIAL_TOOL_NAME.test(name))).toEqual([]);
    }).pipe(Effect.provide(TestLayer)),
  );

  it("list no credential-writing tool in a bot catalog", () => {
    const ids = ISNADI_TOOL_CATALOG.map((tool) => tool.id);

    // Guards the guard, the same way: the catalog the providers read is what is being enumerated.
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toContain("Shell");

    expect(ids.filter((id) => CREDENTIAL_TOOL_NAME.test(id))).toEqual([]);
  });

  it.effect("load no module that imports the credential vault", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const sourceRoot = path.join(import.meta.dirname, "..");

      // The `/mcp` surface whole, and the provider layer that builds bot tool catalogs and runs
      // their handlers.
      const surfaces = [path.join(sourceRoot, "mcp"), path.join(sourceRoot, "provider")];
      const scanned: Array<string> = [];
      const offenders: Array<string> = [];

      const visit = (directory: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          for (const entry of yield* fileSystem.readDirectory(directory).pipe(Effect.orDie)) {
            const filePath = path.join(directory, entry);
            const info = yield* fileSystem.stat(filePath).pipe(Effect.orDie);

            if (info.type === "Directory") {
              yield* visit(filePath);
              continue;
            }

            // Test files name the vault to check it; they ship nothing.
            if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue;

            scanned.push(filePath);

            const source = yield* fileSystem.readFileString(filePath).pipe(Effect.orDie);

            if (importedSpecifiers(source).some(isVaultImport)) offenders.push(filePath);
          }
        });

      yield* Effect.forEach(surfaces, visit, { discard: true });

      // Guards the guard: both surfaces exist and were walked.
      expect(scanned.length).toBeGreaterThan(50);

      const relative = offenders.map((filePath) => path.relative(sourceRoot, filePath));

      expect(relative).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
