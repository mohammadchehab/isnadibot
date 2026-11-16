import { commandRefusalMessage } from "@isnadi/client-runtime/state/runtime";
import { CommandRefusalCodes } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botArchiveFailureToast } from "./botArchive.logic";
import { botDeleteFailureToast } from "./botDelete.logic";

/**
 * An internal id or the invariant's vocabulary, which no copy may contain. Since
 * TASK-384 AC4 neither toast accepts a server sentence at all, so this now pins
 * the copy table itself rather than the toasts' handling of what they were given.
 */
const INTERNAL_PROSE = /person-9f2a|group-7c1d|invariant/i;

/**
 * Both roster toasts against every refusal code the contracts define, not just
 * the two a toast happens to name.
 *
 * TASK-302: the two authorization refusals carried a person id and a group id
 * on the roster menu because neither toast had a branch for them. A coded throw
 * whose surface has no copy for that code leaks exactly like an uncoded one, so
 * the guarantee here is per code rather than per branch.
 */
describe("refusal parity across the roster toasts", () => {
  it("has shared copy for every refusal code the contracts define", () => {
    // The table is a Record, so a missing code is a compile error; this pins the
    // runtime half the surfaces rely on, that no code is left with no sentence.
    for (const code of CommandRefusalCodes) {
      expect(commandRefusalMessage(code)).not.toBeNull();
    }
  });

  it("never prints an id or the invariant prose, for any code, from either toast", () => {
    for (const code of CommandRefusalCodes) {
      const deleted = botDeleteFailureToast({
        refusal: code,
        botName: "Ada",
        bossSpaceName: "Bookkeeping",
      });

      const archived = botArchiveFailureToast({
        refusal: code,
        botName: "Ada",
        bossSpaceName: "Bookkeeping",
      });

      expect(`${deleted.title} ${deleted.description}`).not.toMatch(INTERNAL_PROSE);
      expect(`${archived.title} ${archived.description}`).not.toMatch(INTERNAL_PROSE);
    }
  });

  it("says the shared sentence for the two refusals that used to leak ids", () => {
    // The live defect, reachable from a standard-scope paired client: archiving
    // a bot in a space the person is not in, or without access:write, printed
    // the server's sentence with a person id and a group id.
    for (const code of ["environment-rights", "actor-not-a-group-member"] as const) {
      const shared = commandRefusalMessage(code);

      expect(shared).not.toBeNull();
      expect(
        botDeleteFailureToast({
          refusal: code,
          botName: "Ada",
          bossSpaceName: null,
        }).description,
      ).toBe(shared);
      expect(
        botArchiveFailureToast({
          refusal: code,
          botName: "Ada",
          bossSpaceName: "Bookkeeping",
        }).description,
      ).toBe(shared);
    }
  });

  it("says the same generic line for a code no client knows yet, on both toasts", () => {
    // TASK-384 AC4: a newer server's refusal code is not news this build can
    // word, so both surfaces say their own generic line rather than printing
    // server prose. The parity is what keeps web and mobile from drifting.
    expect(
      botDeleteFailureToast({ refusal: "unknown", botName: "Ada", bossSpaceName: null })
        .description,
    ).toBe("The command failed.");
    expect(
      botArchiveFailureToast({ refusal: "unknown", botName: "Ada", bossSpaceName: null })
        .description,
    ).toBe("The command failed.");
  });
});
