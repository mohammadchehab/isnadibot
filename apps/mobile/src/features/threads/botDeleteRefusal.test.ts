import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { createTranslator } from "@isnadi/client-runtime/i18n";
import { commandRefusalOf } from "@isnadi/client-runtime/state/runtime";

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
  });
});
