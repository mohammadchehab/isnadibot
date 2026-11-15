import {
  AuthAdministrativeScopes,
  AuthStandardClientScopes,
  type AuthEnvironmentScope,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { squadSetupReadOnly } from "./squadSetupAccess";

const standardScopes: ReadonlyArray<AuthEnvironmentScope> = [...AuthStandardClientScopes];

const administrativeScopes: ReadonlyArray<AuthEnvironmentScope> = [...AuthAdministrativeScopes];

describe("squadSetupReadOnly", () => {
  it("is true for a paired client whose scopes stop short of access:write", () => {
    expect(squadSetupReadOnly({ authenticated: true, scopes: standardScopes })).toBe(true);
  });

  it("is false for the client that runs the environment", () => {
    expect(squadSetupReadOnly({ authenticated: true, scopes: administrativeScopes })).toBe(false);
  });

  // Create is a control the user can see. Taking it away on a session that has
  // not answered would be a guess, and a guess that hides the only way forward.
  it("is false before the session answers", () => {
    expect(squadSetupReadOnly(null)).toBe(false);
  });

  it("is false when the session reports no scopes at all", () => {
    expect(squadSetupReadOnly({ authenticated: true })).toBe(false);
  });

  it("is false for a session that never authenticated", () => {
    expect(squadSetupReadOnly({ authenticated: false, scopes: standardScopes })).toBe(false);
  });
});
