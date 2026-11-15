import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { arCatalog } from "../i18n/catalogs/ar/index.ts";
import { zhCNCatalog } from "../i18n/catalogs/zh-CN/index.ts";
import { createTranslator } from "../i18n/translator.ts";
import { classifyCommandFailure, commandFailureMessage } from "./commandFailure.ts";

/** Anything a failure's cause can squash to, so each case below reads on its own. */
type SquashedFailure = Error | Record<string, string> | string | null | undefined;

const failed = (error: SquashedFailure) => ({ cause: Cause.fail(error) });

/** The refusal the decider throws for an actor without `access:write`. */
const rightsRefusal = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Person 'person-7f3a' needs 'access:write' to change the environment.",
  refusal: "environment-rights",
};

/** The refusal the decider throws for an actor outside the group it is changing. */
const membershipRefusal = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Person 'person-7f3a' is not a member of group 'group-91b2'.",
  refusal: "actor-not-a-group-member",
};

/** The refusal the decider throws when the roster offers a bot the space dropped. */
const staleMemberRefusal = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Bot 'bot-4c81' is not a member of group 'group-91b2'.",
  refusal: "bot-not-a-group-member",
};

/** The refusal the decider throws when another bot already leads the space. */
const bossTakenRefusal = {
  _tag: "OrchestrationCommandInvariantError",
  message:
    "Group 'group-91b2' already has boss bot 'bot-4c81'. Use 'group.boss.set' to replace it.",
  refusal: "group-already-has-boss",
};

/**
 * The three thread-state codes, each with the English sentence it shows and the
 * invariant prose the server sends alongside it. Every server sentence here
 * carries a thread or message id, which is exactly what the copy must not leak.
 */
const threadStateRefusals = [
  {
    refusal: "thread-is-busy",
    sentence: "This chat has work in flight. Wait for it to finish, or respond to it.",
    serverMessage: "thread thread-7f3a has an active session and cannot be settled",
  },
  {
    refusal: "thread-state-invalid",
    sentence: "That action does not fit this chat's current state. Refresh and try again.",
    serverMessage: "Thread 'thread-7f3a' is not a group chat, so it has no hop budget.",
  },
  {
    refusal: "channel-delivery-unavailable",
    sentence: "Channel delivery is not available for this chat or message.",
    serverMessage: "Channel delivery can only mark an assistant message in thread 'thread-7f3a'.",
  },
] as const;

/** The refusal the decider throws when a create names a bot with another live home. */
const botInAnotherGroupRefusal = {
  _tag: "OrchestrationCommandInvariantError",
  message: "Bot 'bot-4c81' already belongs to group 'group-91b2'.",
  refusal: "bot-in-another-group",
};

describe("classifyCommandFailure", () => {
  // The server attaches the code at the throw site, so these cases assert the
  // discriminant and never the sentence.
  it("reads each code the client knows", () => {
    expect(classifyCommandFailure(failed({ refusal: "environment-rights" }))).toBe(
      "environment-rights",
    );
    expect(classifyCommandFailure(failed({ refusal: "open-work-items" }))).toBe("open-work-items");
    expect(classifyCommandFailure(failed({ refusal: "bot-is-group-boss" }))).toBe(
      "bot-is-group-boss",
    );
    expect(classifyCommandFailure(failed({ refusal: "group-would-be-undersized" }))).toBe(
      "group-would-be-undersized",
    );
    expect(classifyCommandFailure(failed({ refusal: "actor-not-a-group-member" }))).toBe(
      "actor-not-a-group-member",
    );
    expect(classifyCommandFailure(failed({ refusal: "bot-not-a-group-member" }))).toBe(
      "bot-not-a-group-member",
    );
    expect(classifyCommandFailure(failed({ refusal: "group-already-has-boss" }))).toBe(
      "group-already-has-boss",
    );
    expect(classifyCommandFailure(failed({ refusal: "bot-in-another-group" }))).toBe(
      "bot-in-another-group",
    );
  });

  it("keeps a code a newer server added out of the known set", () => {
    expect(classifyCommandFailure(failed({ refusal: "quota-exceeded" }))).toBe("unknown");
  });

  it("reads each thread-state code rather than falling back to unknown", () => {
    for (const { refusal } of threadStateRefusals) {
      expect(classifyCommandFailure(failed({ refusal }))).toBe(refusal);
    }
  });

  it("is unknown for a failure that carries no code", () => {
    expect(classifyCommandFailure(failed(new Error("Boom")))).toBe("unknown");
    expect(classifyCommandFailure(failed(undefined))).toBe("unknown");
    expect(classifyCommandFailure(failed(null))).toBe("unknown");
    expect(classifyCommandFailure(failed("open-work-items"))).toBe("unknown");
  });
});

describe("commandFailureMessage", () => {
  it("replaces a known refusal with copy that carries no internal ids", () => {
    const message = commandFailureMessage(failed(rightsRefusal));

    expect(message).toBe("Changing this environment needs permission. Ask the person who runs it.");
    expect(message).not.toContain("person-7f3a");
    expect(message).not.toContain("access:write");
  });

  it("replaces a membership refusal with copy that names no person or group", () => {
    const message = commandFailureMessage(failed(membershipRefusal));

    expect(message).toBe(
      "You are not a member of this space. Ask the person who runs it for access.",
    );
    expect(message).not.toContain("Person '");
    expect(message).not.toContain("Group '");
    expect(message).not.toContain("person-7f3a");
    expect(message).not.toContain("group-91b2");
  });

  it("renders the membership refusal in every locale without an internal id", () => {
    const sentences = [
      createTranslator("en").translate,
      createTranslator("ar", arCatalog).translate,
      createTranslator("zh-CN", zhCNCatalog).translate,
    ].map((t) => commandFailureMessage(failed(membershipRefusal), { t }));

    for (const sentence of sentences) {
      expect(sentence).not.toContain("Person '");
      expect(sentence).not.toContain("Group '");
      expect(sentence).not.toContain("person-7f3a");
      expect(sentence).not.toContain("group-91b2");
    }

    // A catalog that forgot the sentence would fall back to English and collide.
    expect(new Set(sentences).size).toBe(3);
  });

  it("replaces a stale-member refusal with copy that names no bot or group", () => {
    const message = commandFailureMessage(failed(staleMemberRefusal));

    expect(message).toBe("That bot is no longer in this space. Refresh to see the current team.");
    expect(message).not.toContain("Bot '");
    expect(message).not.toContain("Group '");
    expect(message).not.toContain("bot-4c81");
    expect(message).not.toContain("group-91b2");
  });

  it("replaces a taken-boss refusal with copy that names no bot or group", () => {
    const message = commandFailureMessage(failed(bossTakenRefusal));

    expect(message).toBe(
      "This space already has a boss. Replace the boss before making this bot the boss.",
    );
    expect(message).not.toContain("Bot '");
    expect(message).not.toContain("Group '");
    expect(message).not.toContain("bot-4c81");
    expect(message).not.toContain("group-91b2");
  });

  it("renders both roster refusals in every locale without an internal id", () => {
    const translators = [
      createTranslator("en").translate,
      createTranslator("ar", arCatalog).translate,
      createTranslator("zh-CN", zhCNCatalog).translate,
    ];

    for (const refusal of [staleMemberRefusal, bossTakenRefusal]) {
      const sentences = translators.map((t) => commandFailureMessage(failed(refusal), { t }));

      for (const sentence of sentences) {
        expect(sentence).not.toContain("Bot '");
        expect(sentence).not.toContain("Group '");
        expect(sentence).not.toContain("bot-4c81");
        expect(sentence).not.toContain("group-91b2");
      }

      // A catalog that forgot the sentence would fall back to English and collide.
      expect(new Set(sentences).size).toBe(3);
    }
  });

  it("replaces every thread-state refusal with copy that names no chat or message", () => {
    for (const { refusal, sentence, serverMessage } of threadStateRefusals) {
      const message = commandFailureMessage(failed({ refusal, message: serverMessage }));

      expect(message).toBe(sentence);
      expect(message).not.toContain("thread-7f3a");
      expect(message).not.toContain("Person '");
      expect(message).not.toContain("Bot '");
      expect(message).not.toContain("Group '");
    }
  });

  it("renders every thread-state refusal in each locale, all three distinct", () => {
    const translators = [
      createTranslator("en").translate,
      createTranslator("ar", arCatalog).translate,
      createTranslator("zh-CN", zhCNCatalog).translate,
    ];

    for (const { refusal, serverMessage } of threadStateRefusals) {
      const sentences = translators.map((t) =>
        commandFailureMessage(failed({ refusal, message: serverMessage }), { t }),
      );

      for (const sentence of sentences) {
        expect(sentence).not.toContain("thread-7f3a");
        expect(sentence).not.toContain("Person '");
        expect(sentence).not.toContain("Bot '");
        expect(sentence).not.toContain("Group '");
        // A catalog that forgot the sentence would fall back to English and
        // collide with the others.
        expect(sentence).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      }

      expect(new Set(sentences).size).toBe(3);
    }
  });

  it("replaces a second-home refusal with copy that names no bot or group", () => {
    const message = commandFailureMessage(failed(botInAnotherGroupRefusal));

    expect(message).toBe(
      "This bot belongs to another space. Create this space without it, then add the bot.",
    );
    expect(message).not.toContain("Bot '");
    expect(message).not.toContain("Group '");
    expect(message).not.toContain("bot-4c81");
    expect(message).not.toContain("group-91b2");
  });

  it("renders the second-home refusal in every locale without an internal id", () => {
    const sentences = [
      createTranslator("en").translate,
      createTranslator("ar", arCatalog).translate,
      createTranslator("zh-CN", zhCNCatalog).translate,
    ].map((t) => commandFailureMessage(failed(botInAnotherGroupRefusal), { t }));

    for (const sentence of sentences) {
      expect(sentence).not.toContain("Bot '");
      expect(sentence).not.toContain("Group '");
      expect(sentence).not.toContain("bot-4c81");
      expect(sentence).not.toContain("group-91b2");
    }

    // A catalog that forgot the sentence would fall back to English and collide.
    expect(new Set(sentences).size).toBe(3);
  });

  it("keeps the server sentence for a code it does not know", () => {
    expect(
      commandFailureMessage(failed({ refusal: "quota-exceeded", message: "Quota reached." })),
    ).toBe("Quota reached.");

    // A thread-state code this client predates must still say something true
    // rather than guess at copy: the sentence survives verbatim.
    expect(
      commandFailureMessage(
        failed({
          refusal: "thread-state-unheard-of",
          message: "Thread 'thread-7f3a' is not a group chat, so it has no hop budget.",
        }),
      ),
    ).toBe("Thread 'thread-7f3a' is not a group chat, so it has no hop budget.");
  });

  it("falls back to the surface's own sentence when the server sent none", () => {
    expect(
      commandFailureMessage(failed(new Error("  ")), { fallback: "The memory was not saved." }),
    ).toBe("The memory was not saved.");
  });

  it("translates the refusal through the translator it is given", () => {
    const t = (message: string) => `translated: ${message}`;

    expect(commandFailureMessage(failed(rightsRefusal), { t })).toBe(
      "translated: Changing this environment needs permission. Ask the person who runs it.",
    );
  });
});
