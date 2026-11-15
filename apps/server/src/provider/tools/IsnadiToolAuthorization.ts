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
}): string | null {
  const { tool, approvalCeiling } = input;

  // No definition is a tool the ceiling does not classify: memory and MCP tools
  // never reach it, so they keep whatever gate they had.
  if (!tool || !approvalCeiling) return null;

  const action = isnadiToolApprovalForInput(
    tool,
    input.input,
    input.workspaceType === undefined ? {} : { workspaceType: input.workspaceType },
  );

  if (APPROVAL_RANK.indexOf(action) <= APPROVAL_RANK.indexOf(approvalCeiling)) return null;

  if (approvalCeiling === "none") return approvalUnavailableRefusal(tool.id);

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
