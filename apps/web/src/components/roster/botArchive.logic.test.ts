import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { botArchiveFailureToast, classifyBotArchiveFailure } from "./botArchive.logic";

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
  it("names the two-bot floor instead of the invariant sentence", () => {
    // Archiving one of two bots in a space is refused by the decider. The old
    // toast printed that sentence verbatim, group id included.
    const toast = botArchiveFailureToast({
      refusal: "group-would-be-undersized",
      message:
        "Orchestration command invariant failed (bot.archive): Group 'grp-9f2' requires at least two active bots.",
      botName: "Ada",
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
      }).description,
    ).toBe("The command failed.");
  });
});
