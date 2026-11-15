import { commandRefusalMessage } from "@isnadi/client-runtime/state/runtime";
import { CommandRefusalCodes } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { botArchiveFailureToast } from "./botArchive.logic";
import { botDeleteFailureToast } from "./botDelete.logic";

/**
 * A refusal sentence the way the server writes it: the invariant's own prose, a
 * person id, and a group id. None of it may reach a person.
 */
const serverSentence = (code: string) =>
  `Orchestration command invariant failed (bot.delete): Person 'person-9f2a' is not a member of group 'group-7c1d'. [${code}]`;

/** An internal id or the invariant's vocabulary, which no copy may contain. */
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
      const message = serverSentence(code);

      const deleted = botDeleteFailureToast({
        refusal: code,
        message,
        botName: "Ada",
        bossSpaceName: "Bookkeeping",
      });

      const archived = botArchiveFailureToast({ refusal: code, message, botName: "Ada" });

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
          message: serverSentence(code),
          botName: "Ada",
          bossSpaceName: null,
        }).description,
      ).toBe(shared);
      expect(
        botArchiveFailureToast({ refusal: code, message: serverSentence(code), botName: "Ada" })
          .description,
      ).toBe(shared);
    }
  });

  it("keeps the server's sentence for a code no client knows yet", () => {
    // The other half of the contract: a newer server's refusal still reads
    // instead of collapsing to a generic line the person cannot act on.
    expect(
      botDeleteFailureToast({
        refusal: "unknown",
        message: "This bot still answers a call.",
        botName: "Ada",
        bossSpaceName: null,
      }).description,
    ).toBe("This bot still answers a call.");
  });
});
