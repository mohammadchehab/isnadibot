import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { createTranslator } from "@isnadi/client-runtime/i18n";
import { commandRefusalMessage, commandRefusalOf } from "@isnadi/client-runtime/state/runtime";
import { CommandRefusalCodes } from "@isnadi/contracts";

import { botDeleteRefusalCopy, type DeleteBotFailure } from "./botDeleteRefusal";

const englishTranslate = createTranslator("en").translate;

/** A translator that marks every key it sees, so a caller that skips it fails here. */
const markingTranslate = (message: string) => `xx:${message}`;

/** The shape the composer hands the sheet: the code the server sent, plus its own sentence. */
const botDeleteFailure = (refusal: string): DeleteBotFailure => ({
  refusal: commandRefusalOf({
    cause: Cause.fail({ refusal, message: "Bot 'bot-7' is the boss of group 'group-3'." }),
  }),
  message: "Bot 'bot-7' is the boss of group 'group-3'.",
});

describe("commandRefusalOf", () => {
  it("reads the typed code a refused command carries", () => {
    expect(botDeleteFailure("bot-is-group-boss").refusal).toBe("bot-is-group-boss");
  });

  it("calls a code this client does not know unknown, so a caller can fall back", () => {
    expect(botDeleteFailure("something-newer").refusal).toBe("unknown");
  });

  it("calls a plain defect unknown", () => {
    expect(commandRefusalOf({ cause: Cause.die(new Error("boom")) })).toBe("unknown");
  });
});

describe("botDeleteRefusalCopy", () => {
  const botName = "Ada";
  const bossRefusal = botDeleteFailure("bot-is-group-boss");

  it("explains a boss refusal in plain words with no id in either line", () => {
    const copy = botDeleteRefusalCopy({ failure: bossRefusal, botName }, englishTranslate);

    expect(copy).toEqual({
      title: "Could not delete Ada",
      description: "Pick a new boss, or delete the space.",
    });
    expect(`${copy.title} ${copy.description}`).not.toMatch(/bot-\d|group-\d/);
  });

  it("explains the two-bot floor in plain words with no id in either line", () => {
    const copy = botDeleteRefusalCopy(
      { failure: botDeleteFailure("group-would-be-undersized"), botName },
      englishTranslate,
    );

    expect(copy).toEqual({
      title: "This group needs at least two bots",
      description:
        "Deleting this bot would leave this space with fewer than two. Add another bot first.",
    });
    expect(`${copy.title} ${copy.description}`).not.toMatch(/bot-\d|group-\d/);
  });

  it("keeps the server's sentence for a refusal the client cannot name", () => {
    const failure: DeleteBotFailure = {
      refusal: "unknown",
      message: "The space was archived while you were deleting it.",
    };

    expect(botDeleteRefusalCopy({ failure, botName }, englishTranslate)).toEqual({
      title: "Could not delete Ada",
      description: "The space was archived while you were deleting it.",
    });
  });

  it("says something true when even the server's sentence is empty", () => {
    const copy = botDeleteRefusalCopy(
      { failure: { refusal: "unknown", message: "   " }, botName },
      englishTranslate,
    );

    expect(copy.description).toBe("The command failed.");
  });

  it("renders through the translator the sheet passes, not English", () => {
    expect(botDeleteRefusalCopy({ failure: bossRefusal, botName }, markingTranslate)).toEqual({
      title: "xx:Could not delete {name}",
      description: "xx:Pick a new boss, or delete the space.",
    });
    expect(
      botDeleteRefusalCopy(
        { failure: botDeleteFailure("group-would-be-undersized"), botName },
        markingTranslate,
      ),
    ).toEqual({
      title: "xx:This group needs at least two bots",
      description:
        "xx:Deleting this bot would leave this space with fewer than two. Add another bot first.",
    });
  });

  it("never prints an id or the invariant prose, for any refusal code", () => {
    // TASK-302: the two authorization refusals carried a person id and a group
    // id because this copy had no branch for them. The shared table fixes every
    // code at once, so the guarantee is per code, not per branch.
    const serverSentence = (code: string) =>
      `Orchestration command invariant failed (bot.delete): Person 'person-9f2a' is not a member of group 'group-7c1d'. [${code}]`;

    for (const code of CommandRefusalCodes) {
      const copy = botDeleteRefusalCopy(
        { failure: { refusal: code, message: serverSentence(code) }, botName },
        englishTranslate,
      );

      expect(`${copy.title} ${copy.description}`).not.toMatch(/person-9f2a|group-7c1d|invariant/i);
    }
  });

  it("says the shared sentence for the two refusals that used to leak ids", () => {
    for (const code of ["environment-rights", "actor-not-a-group-member"] as const) {
      const shared = commandRefusalMessage(code);

      expect(shared).not.toBeNull();
      expect(
        botDeleteRefusalCopy(
          {
            failure: {
              refusal: code,
              message: `Person 'person-9f2a' is not a member of group 'group-7c1d'.`,
            },
            botName,
          },
          englishTranslate,
        ).description,
      ).toBe(shared);
    }
  });
});
