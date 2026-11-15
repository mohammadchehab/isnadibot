import { AuthAccessWriteScope, type AuthSessionState } from "@isnadi/contracts";

/**
 * Whether this client is known to lack the right to create a space. Hiring
 * writes the environment's roster, so the server refuses `fleet.hire` without
 * `access:write`; squad setup asks the same question before Create, so a
 * standard-scope client is told before it presses rather than after.
 *
 * Only a session that positively lacks the scope counts. One that has not
 * answered yet, or that could not be read, leaves Create live: a refusal that
 * says why is a better outcome than a control that never tried.
 */
export function squadSetupReadOnly(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null,
): boolean {
  if (session?.authenticated !== true || session.scopes === undefined) return false;

  return !session.scopes.includes(AuthAccessWriteScope);
}
