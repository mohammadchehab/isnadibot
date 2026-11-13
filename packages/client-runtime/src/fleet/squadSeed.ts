/**
 * Seeding moved to `@isnadi/shared/fleet` for the same reason as the plan: the
 * server resolves a role's engine when it hires. Re-exported so the screens
 * that preview a hire keep their import.
 */
export {
  seedSquad,
  seedSquadMember,
  type SquadMemberSeed,
  type SquadSeed,
  type SquadSeedNotice,
} from "@isnadi/shared/fleet";
