/**
 * TASK-29.1 AC7: nothing that writes a credential is reachable by a bot.
 *
 * The vault's write path needs the `access:write` scope, which no bot, provider
 * session, or standard paired client carries, and no credential-writing call is
 * registered on `/mcp` or in a bot tool catalog. Today no vault RPC exists yet,
 * so these guards pass trivially. They exist to fail on the day one is added to
 * a surface a bot can reach, while the decision is still cheap.
 */
import {
  AuthAccessWriteScope,
  AuthStandardClientScopes,
  ISNADI_TOOL_CATALOG,
  ISNADI_TOOL_IDS,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
} from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { McpServer } from "effect/unstable/ai";

import { RPC_REQUIRED_SCOPES } from "../auth/RpcAuthorization.ts";
import { TestLayer } from "../mcp/testUtils/mcpHttpServer.ts";

/**
 * The name is the only handle every surface shares (a tool id, a registration
 * name, an RPC method), so it is the one place a guard can look. A tool that
 * writes a credential has to name itself after one of these to be usable.
 */
const CREDENTIAL_WRITING_NAME = /secret|credential|vault|password|keychain|api[-_]?key/i;

const credentialNamesIn = (names: readonly string[]) =>
  names.filter((name) => CREDENTIAL_WRITING_NAME.test(name));

it("flags a credential-writing name, so an empty result means absence", () => {
  // Positive control: without this, a broken pattern would make every guard below
  // pass while guarding nothing.
  expect(credentialNamesIn(["VaultWriteSecret", "Shell", "Read"])).toEqual(["VaultWriteSecret"]);
});

it.effect("exposes no credential-writing tool on /mcp", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const names = server.tools.map(({ tool }) => tool.name);

    // A guard that reads an empty list would pass forever, so prove the
    // enumeration found the toolkit it is guarding.
    expect(names.length).toBeGreaterThan(0);
    expect(credentialNamesIn(names)).toEqual([]);
  }).pipe(Effect.provide(TestLayer)),
);

it("hands a bot no credential-writing tool from its catalog", () => {
  expect(credentialNamesIn(ISNADI_TOOL_CATALOG.map((tool) => tool.id))).toEqual([]);
});

it("hands a bot no credential-writing tool from its runtime vocabulary", () => {
  // Every id `implementedTools` may add to a session; the literal schema is
  // derived from this list, so this is the whole vocabulary, not a sample.
  expect(credentialNamesIn(ISNADI_TOOL_IDS)).toEqual([]);
});

it("requires access:write for every credential-writing RPC", () => {
  const methods = [...Object.values(WS_METHODS), ...Object.values(ORCHESTRATION_WS_METHODS)];

  for (const method of credentialNamesIn(methods)) {
    expect([method, RPC_REQUIRED_SCOPES[method as keyof typeof RPC_REQUIRED_SCOPES]]).toEqual([
      method,
      AuthAccessWriteScope,
    ]);
  }
});

it("grants access:write to no standard paired client", () => {
  expect(AuthStandardClientScopes).not.toContain(AuthAccessWriteScope);
});
