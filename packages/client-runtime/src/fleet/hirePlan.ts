/**
 * The plan lives in `@isnadi/shared/fleet` so the server computes the same one
 * the client previewed; the shapes it returns are contract types, so they are
 * re-exported straight from `@isnadi/contracts` rather than through the plan.
 * Re-exported here because the web and mobile hire flows already import this path.
 */
export { planFleetHire, type FleetHireNames } from "@isnadi/shared/fleet";

export type {
  FleetHireBlocker,
  FleetHireMember,
  FleetHirePick,
  FleetHirePlan,
} from "@isnadi/contracts";
