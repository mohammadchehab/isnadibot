import { EnvironmentId } from "@isnadi/contracts";

import { usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentSessionState } from "../../state/session";
import { squadSetupReadOnly } from "./squadSetupAccess";

/** The id the session query is asked about while there is no environment to ask. */
// SAFETY: the empty ID is an inactive-query sentinel; no environment request is sent for it.
const NO_ENVIRONMENT = "" as EnvironmentId;

/** `squadSetupReadOnly` for the primary environment, the one a hire reaches. */
export function useSquadSetupReadOnly(): boolean {
  const environmentId = usePrimaryEnvironmentId();
  const session = useEnvironmentSessionState(environmentId ?? NO_ENVIRONMENT);

  return squadSetupReadOnly(session.data);
}
