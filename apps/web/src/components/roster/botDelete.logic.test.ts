import { BotId, GroupId, type OrchestrationGroup } from "@isnadi/contracts";
import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import {
  bossGroupOf,
  botDeleteConfirmMessage,
  botDeleteFailureToast,
  classifyBotDeleteFailure,
} from "./botDelete.logic";

/**
 * A translator that marks every key it sees, so a caller that forgets to pass
 * the UI's `t` shows up as English and fails the test rather than shipping.
 */
const arabicTranslate = (message: string) => `ar:${message}`;

/** Anything a failure's cause can squash to, so each case below reads on its own. */
type SquashedFailure = Error | Record<string, string> | string | null | undefined;

const failed = (error: SquashedFailure) => ({ cause: Cause.fail(error) });

function group(id: string, overrides: Partial<OrchestrationGroup> = {}): OrchestrationGroup {
  return {
    id: GroupId.make(id),
    name: `Space ${id}`,
    bossBotId: null,
    members: [],
    fleetTemplateId: null,
    createdAt: "2026-11-14T08:00:00.000Z",
    updatedAt: "2026-11-14T08:00:00.000Z",
    ...overrides,
  };
}

describe("bossGroupOf", () => {
  it("finds the group this bot leads", () => {
    const groups = [
      group("a", { bossBotId: BotId.make("bot-2") }),
      group("b", { bossBotId: BotId.make("bot-1") }),
    ];

    expect(bossGroupOf(groups, "bot-1")?.id).toBe("b");
    expect(bossGroupOf(groups, "bot-2")?.id).toBe("a");
  });

  it("is null for a bot that leads nothing", () => {
    expect(bossGroupOf([group("a")], "bot-1")).toBeNull();
    expect(bossGroupOf([], "bot-1")).toBeNull();
  });
});

describe("classifyBotDeleteFailure", () => {
  // The server attaches the code at the throw site, so these cases assert the
  // discriminant and never the sentence: a copyedit of the invariant must not
  // reach this test.
  it("reads the boss refusal code", () => {
    expect(classifyBotDeleteFailure(failed({ refusal: "bot-is-group-boss" }))).toBe(
      "bot-is-group-boss",
    );
  });

  it("keeps the refusal codes it shares with every other command", () => {
    expect(classifyBotDeleteFailure(failed({ refusal: "open-work-items" }))).toBe(
      "open-work-items",
    );
  });

  it("is unknown for a code this client does not know, and for a failure with none", () => {
    expect(classifyBotDeleteFailure(failed({ refusal: "bot-was-already-deleted" }))).toBe(
      "unknown",
    );
    expect(
      classifyBotDeleteFailure(failed({ message: "Bot 'bot-1' is the boss of group 'g'." })),
    ).toBe("unknown");
    expect(classifyBotDeleteFailure(failed(new Error("Boom")))).toBe("unknown");
    expect(classifyBotDeleteFailure(failed(undefined))).toBe("unknown");
    expect(classifyBotDeleteFailure(failed(null))).toBe("unknown");
    expect(classifyBotDeleteFailure(failed("bot-is-group-boss"))).toBe("unknown");
  });
});

describe("botDeleteConfirmMessage", () => {
  it("asks the plain delete question when the bot leads nothing", () => {
    expect(botDeleteConfirmMessage({ botName: "Ada", bossSpaceName: null })).toBe(
      "Delete Ada? Its chats stay in your history. This cannot be undone.",
    );
  });

  it("names the bot and the space it leads, and the way past it", () => {
    expect(botDeleteConfirmMessage({ botName: "Ada", bossSpaceName: "Bookkeeping" })).toBe(
      "Delete Ada? Ada is the boss of Bookkeeping. Pick a new boss in the space first, or delete the space.",
    );
  });

  it("asks in the caller's language, not English", () => {
    // TASK-237 regression: the component called this without its translator, so
    // the shipped ar and zh-CN roster keys never reached the dialog.
    expect(
      botDeleteConfirmMessage({ botName: "Ada", bossSpaceName: "Bookkeeping" }, arabicTranslate),
    ).toBe(
      "ar:Delete {name}? {name} is the boss of {space}. Pick a new boss in the space first, or delete the space.",
    );
  });

  it("keeps the question first so the dialog splits into title and description", () => {
    // The shipped renderer cuts at the first question mark: everything up to it
    // is the dialog title, the rest is its description.
    const message = botDeleteConfirmMessage({ botName: "Ada", bossSpaceName: "Bookkeeping" });
    const cut = message.indexOf("?");

    expect(message.slice(0, cut + 1)).toBe("Delete Ada?");
    expect(message.slice(cut + 1).trim()).toBe(
      "Ada is the boss of Bookkeeping. Pick a new boss in the space first, or delete the space.",
    );
  });
});

describe("botDeleteFailureToast", () => {
  it("offers the way out when the bot became a boss before the delete landed", () => {
    expect(
      botDeleteFailureToast({
        refusal: "bot-is-group-boss",
        message: "Orchestration command invariant failed (bot.delete): Bot 35db651c is the boss.",
        botName: "Ada",
        bossSpaceName: "Bookkeeping",
      }),
    ).toEqual({
      title: "Boss of Bookkeeping",
      description: "Pick a new boss, or delete the space.",
      actionLabel: "Pick a new boss",
    });
  });

  it("drops the action when the space on screen is not known yet", () => {
    expect(
      botDeleteFailureToast({
        refusal: "bot-is-group-boss",
        message: "",
        botName: "Ada",
        bossSpaceName: null,
      }),
    ).toEqual({
      title: "Could not delete Ada",
      description: "Pick a new boss, or delete the space.",
      actionLabel: null,
    });
  });

  it("shows the toast in the caller's language, not English", () => {
    // Same regression as the confirmation above, on the failure path.
    const toast = botDeleteFailureToast(
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
    expect(toast.actionLabel).toBe("ar:Pick a new boss");
  });

  it("never shows the invariant sentence for a boss refusal", () => {
    // The audit's defect: the old toast printed error.message verbatim, ids and
    // all. A refusal the client can name is rewritten, whatever the server said.
    const invariant =
      "Orchestration command invariant failed (bot.delete): Bot '35db651c-1a2b' is the boss of group 'b5542e55-9c3d'.";

    for (const bossSpaceName of ["Bookkeeping", null]) {
      const toast = botDeleteFailureToast({
        refusal: "bot-is-group-boss",
        message: invariant,
        botName: "Ada",
        bossSpaceName,
      });

      expect(toast.title).not.toContain("35db651c");
      expect(toast.description).not.toContain("35db651c");
      expect(toast.description).not.toContain("invariant");
    }
  });

  it("keeps the server's own sentence for a code this client does not know", () => {
    // The TASK-232 fallback: a newer server's refusal still reads, rather than
    // collapsing to a generic line the user cannot act on.
    expect(
      botDeleteFailureToast({
        refusal: "unknown",
        message: "This bot still answers a call.",
        botName: "Ada",
        bossSpaceName: null,
      }),
    ).toEqual({
      title: "Could not delete Ada",
      description: "This bot still answers a call.",
      actionLabel: null,
    });

    expect(
      botDeleteFailureToast({
        refusal: "unknown",
        message: "  ",
        botName: "Ada",
        bossSpaceName: null,
      }).description,
    ).toBe("The command failed.");
  });
});
