import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { botArchiveFailureToast, classifyBotArchiveFailure } from "./botArchive.logic";
import { botDeleteFailureToast } from "./botDelete.logic";

/**
 * A translator that marks every key it sees, so a caller that forgets to pass
 * the UI's `t` shows up as English and fails the test rather than shipping.
 */
const arabicTranslate = (message: string) => `ar:${message}`;

/** Anything a failure's cause can squash to, so each case below reads on its own. */
type SquashedFailure = Error | Record<string, string> | string | null | undefined;

const failed = (error: SquashedFailure) => ({ cause: Cause.fail(error) });

describe("classifyBotArchiveFailure", () => {
  // The server attaches the code at the throw site, so these cases assert the
  // discriminant and never the sentence: a copyedit of the invariant must not
  // reach this test.
  it("reads the undersized refusal code", () => {
    expect(classifyBotArchiveFailure(failed({ refusal: "group-would-be-undersized" }))).toBe(
      "group-would-be-undersized",
    );
  });

  it("keeps the refusal codes it shares with every other command", () => {
    expect(classifyBotArchiveFailure(failed({ refusal: "bot-is-group-boss" }))).toBe(
      "bot-is-group-boss",
    );
    expect(classifyBotArchiveFailure(failed({ refusal: "open-work-items" }))).toBe(
      "open-work-items",
    );
  });

  it("is unknown for a code this client does not know, and for a failure with none", () => {
    expect(classifyBotArchiveFailure(failed({ refusal: "bot-was-already-archived" }))).toBe(
      "unknown",
    );
    expect(
      classifyBotArchiveFailure(failed({ message: "Bot 'bot-1' is the boss of group 'g'." })),
    ).toBe("unknown");
    expect(classifyBotArchiveFailure(failed(new Error("Boom")))).toBe("unknown");
    expect(classifyBotArchiveFailure(failed(undefined))).toBe("unknown");
    expect(classifyBotArchiveFailure(failed(null))).toBe("unknown");
    expect(classifyBotArchiveFailure(failed("group-would-be-undersized"))).toBe("unknown");
  });
});

describe("botArchiveFailureToast", () => {
  it("names the boss refusal in words, with no bot id or group id", () => {
    // The live defect: archiving a team lead fell through to the invariant
    // sentence, two internal ids on the roster's most-used menu.
    const invariant =
      "Orchestration command invariant failed (bot.archive): Bot '35db651c-1a2b' is the boss of group 'b5542e55-9c3d'.";

    const toast = botArchiveFailureToast({
      refusal: "bot-is-group-boss",
      message: invariant,
      botName: "Ada",
      bossSpaceName: "Bookkeeping",
    });

    expect(toast).toEqual({
      title: "Boss of Bookkeeping",
      description: "Pick a new boss, or delete the space.",
    });
    expect(toast.title).not.toContain("35db651c");
    expect(toast.description).not.toContain("b5542e55");
    expect(toast.description).not.toContain("invariant");
  });

  it("names the action when the space is not on screen yet", () => {
    expect(
      botArchiveFailureToast({
        refusal: "bot-is-group-boss",
        message: "",
        botName: "Ada",
        bossSpaceName: null,
      }),
    ).toEqual({
      title: "Could not archive Ada",
      description: "Pick a new boss, or delete the space.",
    });
  });

  it("reads the same sentence as the delete toast for the same refusal", () => {
    // Delete carried this branch and archive did not, so the two siblings drifted
    // and only delete spoke in words. The title still names the action while the
    // space is unknown; the reason is one sentence in both.
    const invariant = "Orchestration command invariant failed: Bot 'b1' is the boss of group 'g1'.";

    for (const bossSpaceName of ["Bookkeeping", null]) {
      const archived = botArchiveFailureToast({
        refusal: "bot-is-group-boss",
        message: invariant,
        botName: "Ada",
        bossSpaceName,
      });

      const deleted = botDeleteFailureToast({
        refusal: "bot-is-group-boss",
        message: invariant,
        botName: "Ada",
        bossSpaceName,
      });

      expect(archived.description).toBe(deleted.description);
    }
  });

  it("shows the boss refusal in the caller's language, not English", () => {
    const toast = botArchiveFailureToast(
      {
        refusal: "bot-is-group-boss",
        message: "",
        botName: "Ada",
        bossSpaceName: "Bookkeeping",
      },
      arabicTranslate,
    );

    expect(toast.title).toBe("ar:Boss of {space}");
    expect(toast.description).toBe("ar:Pick a new boss, or delete the space.");
  });

  it("names the two-bot floor instead of the invariant sentence", () => {
    // Archiving one of two bots in a space is refused by the decider. The old
    // toast printed that sentence verbatim, group id included.
    const toast = botArchiveFailureToast({
      refusal: "group-would-be-undersized",
      message:
        "Orchestration command invariant failed (bot.archive): Group 'grp-9f2' requires at least two active bots.",
      botName: "Ada",
      bossSpaceName: null,
    });

    expect(toast).toEqual({
      title: "This group needs at least two bots",
      description:
        "Archiving this bot would leave this space with fewer than two. Add another bot first.",
    });
  });

  it("never shows a group id, whatever the server said", () => {
    const invariant =
      "Orchestration command invariant failed (bot.archive): Group 'grp-9f2' requires at least two active bots.";

    const toast = botArchiveFailureToast({
      refusal: "group-would-be-undersized",
      message: invariant,
      botName: "Ada",
      bossSpaceName: null,
    });

    expect(toast.title).not.toContain("grp-9f2");
    expect(toast.description).not.toContain("grp-9f2");
    expect(toast.description).not.toContain("invariant");
  });

  it("shows the toast in the caller's language, not English", () => {
    // The TASK-237 regression: a copy helper called without the UI's translator
    // ships English to ar and zh-CN.
    const toast = botArchiveFailureToast(
      {
        refusal: "group-would-be-undersized",
        message: "",
        botName: "Ada",
        bossSpaceName: null,
      },
      arabicTranslate,
    );

    expect(toast.title).toBe("ar:This group needs at least two bots");
    expect(toast.description).toBe(
      "ar:Archiving this bot would leave this space with fewer than two. Add another bot first.",
    );
  });

  it("keeps the server's own sentence for a code this client does not know", () => {
    // The TASK-232 fallback: a newer server's refusal still reads, rather than
    // collapsing to a generic line the user cannot act on.
    expect(
      botArchiveFailureToast({
        refusal: "unknown",
        message: "This bot still answers a call.",
        botName: "Ada",
        bossSpaceName: null,
      }),
    ).toEqual({
      title: "Could not archive Ada",
      description: "This bot still answers a call.",
    });

    expect(
      botArchiveFailureToast({
        refusal: "unknown",
        message: "  ",
        botName: "Ada",
        bossSpaceName: null,
      }).description,
    ).toBe("The command failed.");
  });
});
