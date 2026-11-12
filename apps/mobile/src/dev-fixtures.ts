/**
 * Metro inlines `__DEV__` at build time, so this is a literal `false` in a release bundle and what
 * it guards is dead code there. The `in globalThis` guard keeps node-based tests that import these
 * modules from throwing.
 *
 * Fixture-backed surfaces hang off it until their RPC wiring lands (decision-53). Today that is the
 * live view: its screen, its route and the entry point that opens it.
 */
export const DEV_FIXTURES_ENABLED = "__DEV__" in globalThis && __DEV__;
