import { Atom } from "effect/unstable/reactivity";
import type { EnvironmentId, IsnadiDelegationRecord } from "@isnadi/contracts";

import { environmentSnapshotAtom } from "./shell";

const NO_DELEGATIONS: ReadonlyArray<IsnadiDelegationRecord> = Object.freeze([]);

/**
 * Every delegation the environment knows about.
 *
 * A delegation card needs the whole list, not just its own record: the chat it
 * started can start others, and those grandchild chats are never listed in the
 * app, so the card is the only surface that can answer their approvals.
 */
export const environmentDelegationsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make(
    (get): ReadonlyArray<IsnadiDelegationRecord> =>
      get(environmentSnapshotAtom(environmentId))?.delegations ?? NO_DELEGATIONS,
  ).pipe(Atom.withLabel(`mobile-delegations:${environmentId}`)),
);
