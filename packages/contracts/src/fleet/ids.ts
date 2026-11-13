import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "../baseSchemas.ts";

/**
 * A fleet role's stable id, as a bot records the role it was hired into and a
 * work item records the role it needs.
 *
 * It lives apart from `roles.ts` because the roster and work-item contracts
 * name it, and `roles.ts` builds its templates out of those contracts: naming
 * it from there would make the two modules import each other.
 */
export const FleetRoleId = TrimmedNonEmptyString.pipe(Schema.brand("FleetRoleId"));

export type FleetRoleId = typeof FleetRoleId.Type;
