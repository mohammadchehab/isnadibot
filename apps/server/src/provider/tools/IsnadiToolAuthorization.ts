import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as Predicate from "effect/Predicate";
import {
  type IsnadiDelegationAccessGrant,
  type IsnadiMemoryTargetScope,
  type IsnadiToolApprovalClass,
  type IsnadiToolDefinition,
  type IsnadiToolWorkspaceType,
  IsnadiToolInputSchemas,
  type IsnadiToolId,
  isnadiToolApprovalForInput,
} from "@isnadi/contracts";

export function field<Value>(value: Value, key: string) {
  if (!Predicate.isObjectOrArray(value) || value === null) return undefined;

  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

export function requiredString<Value>(value: Value, key: string): string {
  const candidate = field(value, key);

  if (!Predicate.isString(candidate) || candidate.length === 0) {
    throw new Error(`Tool input field '${key}' is required.`);
  }

  return candidate;
}

export function canonicalInput<Value>(value: Value): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(",")}]`;

  if (Predicate.isObjectOrArray(value) && value !== null) {
    return `{${Object.keys(value)
      .filter((key) => field(value, key) !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalInput(field(value, key))}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

export function ensureWorkspaceCwd<Input>(toolId: IsnadiToolId, input: Input): void {
  if (toolId !== "Shell" && toolId !== "ExternalShell") return;
  const cwd = field(input, "cwd");

  if (cwd === undefined) return;

  if (!Predicate.isString(cwd)) throw new Error(`Tool '${toolId}' cwd must be a relative path.`);

  if (
    cwd.startsWith("/") ||
    cwd.startsWith("\\") ||
    /^[A-Za-z]:/.test(cwd) ||
    cwd.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(`Tool '${toolId}' cwd must stay inside its workspace.`);
  }
}

export const APPROVAL_RANK = [
  "none",
  "user-computer",
  "send",
  "pay",
  "delete",
  "production",
  "secrets",
] as const;

export const RUNTIME_RANK = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
] as const;

/**
 * The refusal a chat with nobody to ask gives. Shared, so a worker's MCP tool
 * and a catalog tool under a `none` ceiling are told the same thing.
 */
export const approvalUnavailableRefusal = (toolName: string) =>
  `Tool '${toolName}' needs approval, and this chat cannot ask anyone for it. Finish without it or report the blocker.`;

/**
 * The real location of a path with every symlink followed. A path that does not
 * exist yet resolves through its nearest existing ancestor, so a `..` or a link
 * cannot hide behind a missing leaf.
 */
export function realLocation(target: string): string {
  const missing: string[] = [];
  let current = NodePath.resolve(target);

  for (;;) {
    try {
      return NodePath.join(NodeFS.realpathSync(current), ...missing.toReversed());
    } catch {
      const parent = NodePath.dirname(current);

      if (parent === current) return NodePath.resolve(target);
      missing.push(NodePath.basename(current));
      current = parent;
    }
  }
}

/**
 * Whether `target` sits at or below `root`. Expects both arguments canonicalised
 * by {@link realLocation}: the check is string-based, so on raw input a `..` that
 * has not been resolved would read as inside.
 */
export const isInsideRoot = (root: string, target: string) => {
  const relative = NodePath.relative(root, target);

  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
};

/**
 * What a delegation's own grant says about an `ExternalRead`: `approve` when it
 * is an ordinary read inside the granted folder, `outside` (with the reason the
 * boss should see) when it leaves that folder, and `none` when the grant does
 * not speak to this call at all. A boss that delegates `ExternalRead` with
 * user-computer access has consented to reads of the folder the task names, so
 * such a read needs no card, and a `none` ceiling (which nobody can answer)
 * must not strand it. The path is resolved with symlinks followed, so a link
 * or `..` cannot lead out of the folder. A protected path (secrets, production)
 * is the one read this grant never covers: the sensitive-path classifier is the
 * only gate left on it, so it decides every credential name by itself.
 */
type DelegatedReadVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "approve" }
  | { readonly kind: "outside"; readonly reason: string };

export function delegatedReadVerdict(input: {
  readonly tool: IsnadiToolDefinition | undefined;
  readonly input: unknown;
  readonly workspaceType: IsnadiToolWorkspaceType | undefined;
  readonly grant?: IsnadiDelegationAccessGrant | undefined;
  /** The folder the delegation may read: the user computer root of its session. */
  readonly readRoot?: string | undefined;
}): DelegatedReadVerdict {
  const { tool, grant } = input;

  if (tool?.id !== "ExternalRead" || !grant) return { kind: "none" };

  // Only a 'none' ceiling means nobody can answer a card. Any session that can still ask its
  // user keeps its approval card, so a top-level bot never loses it.
  if (grant.approvalCeiling !== "none") return { kind: "none" };

  if (!grant.hasUserComputer || !grant.allowedToolIds.includes("ExternalRead")) {
    return { kind: "none" };
  }

  const action = isnadiToolApprovalForInput(
    tool,
    input.input,
    input.workspaceType === undefined ? {} : { workspaceType: input.workspaceType },
  );

  // A protected path asks for more than a read; the ceiling refuses it.
  if (action !== "user-computer") return { kind: "none" };

  const requested = field(input.input, "path");

  if (!input.readRoot || !Predicate.isString(requested)) {
    return {
      kind: "outside",
      reason: `Tool 'ExternalRead' has no granted folder to read from, and nobody here can approve a read. Report that blocker to your boss so they re-delegate with a folder.`,
    };
  }

  const root = realLocation(input.readRoot);
  const target = realLocation(NodePath.resolve(input.readRoot, requested));

  if (isInsideRoot(root, target)) return { kind: "approve" };

  return {
    kind: "outside",
    reason: `Tool 'ExternalRead' may only read inside the granted folder '${input.readRoot}', and '${requested}' resolves outside it. Nobody here can approve a wider read. Report that blocker to your boss so they re-delegate with the right folder.`,
  };
}

/** Whether the delegation's grant approves this read with no card. */
export const delegationPreApprovesRead = (input: Parameters<typeof delegatedReadVerdict>[0]) =>
  delegatedReadVerdict(input).kind === "approve";

/**
 * The refusal for a call whose approval nobody can give. It names the missing
 * grant so the bot can tell its boss what to change.
 */
const approvalUnavailableForAction = (
  tool: IsnadiToolDefinition,
  action: IsnadiToolApprovalClass,
) =>
  tool.id === "ExternalRead" && action === "user-computer"
    ? `Tool 'ExternalRead' reads the user's computer. This delegation was not granted user-computer access (it needs 'ExternalRead' in its tools and a user computer), and nobody here can approve it. Report that blocker to your boss so they re-delegate with that access.`
    : `${approvalUnavailableRefusal(tool.id)} It is a '${action}' action, which this delegation's approval ceiling 'none' does not allow.`;

/**
 * Why a call above its delegation's approval ceiling is refused, or null when
 * the call is within it. Two places ask, and they must never disagree: the
 * runtime refuses the call, and the controller refuses to show an approval card
 * whose answer the runtime would then ignore. `none` is a ceiling nobody can
 * answer, so its sentence says that rather than naming a ceiling to raise.
 */
export function approvalCeilingRefusal(input: {
  readonly tool: IsnadiToolDefinition | undefined;
  readonly input: unknown;
  readonly workspaceType: IsnadiToolWorkspaceType | undefined;
  readonly approvalCeiling: IsnadiToolApprovalClass | undefined;
  readonly grant?: IsnadiDelegationAccessGrant | undefined;
  readonly readRoot?: string | undefined;
}): string | null {
  const { tool, approvalCeiling } = input;

  // No definition is a tool the ceiling does not classify: memory and MCP tools
  // never reach it, so they keep whatever gate they had.
  if (!tool || !approvalCeiling) return null;

  const read = delegatedReadVerdict({ ...input, tool });

  if (read.kind === "approve") return null;

  if (read.kind === "outside") return read.reason;

  const action = isnadiToolApprovalForInput(
    tool,
    input.input,
    input.workspaceType === undefined ? {} : { workspaceType: input.workspaceType },
  );

  if (APPROVAL_RANK.indexOf(action) <= APPROVAL_RANK.indexOf(approvalCeiling)) return null;

  if (approvalCeiling === "none") return approvalUnavailableForAction(tool, action);

  return `Tool '${tool.id}' is a '${action}' action, and this chat's approval ceiling is '${approvalCeiling}', so approving it here would not run it. Do the work another way, or ask your user to run it.`;
}

export function requestedSubset<T>(
  requested: ReadonlyArray<T> | undefined,
  ceiling: ReadonlyArray<T>,
  label: string,
): ReadonlyArray<T> {
  if (requested?.some((value) => !ceiling.includes(value))) {
    throw new Error(`Delegation requested ${label} outside the parent turn grant.`);
  }

  return requested ?? ceiling;
}

export function intersectDelegationAccess(input: {
  readonly parent: IsnadiDelegationAccessGrant;
  readonly child: IsnadiDelegationAccessGrant;
  readonly requested: (typeof IsnadiToolInputSchemas.SendToAgent)["Type"];
}): IsnadiDelegationAccessGrant {
  const requestedTools = requestedSubset(
    input.requested.allowedToolIds,
    input.parent.allowedToolIds,
    "tools",
  );

  const requestedMemory = requestedSubset<IsnadiMemoryTargetScope>(
    input.requested.memoryScopes,
    input.parent.memoryScopes,
    "memory scopes",
  );

  const requestedMcpServers = requestedSubset(
    input.requested.mcpServerIds,
    input.parent.enabledMcpServerIds,
    "MCP servers",
  );

  const requestedRuntime = input.requested.runtimeMode ?? input.parent.runtimeMode;

  if (RUNTIME_RANK.indexOf(requestedRuntime) > RUNTIME_RANK.indexOf(input.parent.runtimeMode)) {
    throw new Error("Delegation requested a runtime mode above the parent turn grant.");
  }

  const requestedApproval = input.requested.approvalCeiling ?? input.parent.approvalCeiling;

  if (
    APPROVAL_RANK.indexOf(requestedApproval) > APPROVAL_RANK.indexOf(input.parent.approvalCeiling)
  ) {
    throw new Error("Delegation requested approvals above the parent turn grant.");
  }

  if (
    input.requested.sandbox !== undefined &&
    input.requested.sandbox !== null &&
    input.requested.sandbox !== input.parent.sandbox
  ) {
    throw new Error("Delegation requested a sandbox outside the parent turn grant.");
  }

  const sandbox =
    input.requested.sandbox === undefined ? input.parent.sandbox : input.requested.sandbox;

  return {
    allowedToolIds: requestedTools.filter((toolId) => input.child.allowedToolIds.includes(toolId)),
    memoryScopes: requestedMemory.filter((scope) => input.child.memoryScopes.includes(scope)),
    sandbox: sandbox === input.child.sandbox ? sandbox : null,
    runtimeMode:
      RUNTIME_RANK.indexOf(requestedRuntime) <= RUNTIME_RANK.indexOf(input.child.runtimeMode)
        ? requestedRuntime
        : input.child.runtimeMode,
    hasUserComputer: input.parent.hasUserComputer && input.child.hasUserComputer,
    enabledMcpServerIds: requestedMcpServers.filter((serverId) =>
      input.child.enabledMcpServerIds.includes(serverId),
    ),
    disabledMcpServerIds: [
      ...new Set([...input.parent.disabledMcpServerIds, ...input.child.disabledMcpServerIds]),
    ],
    approvalCeiling:
      APPROVAL_RANK.indexOf(requestedApproval) <= APPROVAL_RANK.indexOf(input.child.approvalCeiling)
        ? requestedApproval
        : input.child.approvalCeiling,
  };
}
