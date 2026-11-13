import { createWorkItemEnvironmentAtoms } from "@isnadi/client-runtime/state/work-items";

import { connectionAtomRuntime } from "../connection/runtime";

export const workItemEnvironment = createWorkItemEnvironmentAtoms(connectionAtomRuntime);
