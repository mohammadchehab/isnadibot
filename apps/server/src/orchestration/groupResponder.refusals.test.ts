import { BotId, MessageId, type GroupAddressing, type GroupMembership } from "@isnadi/contracts";
import { describe, expect, it } from "@effect/vitest";
import { resolveGroupAddressing } from "./groupResponder.ts";

/**
 * Every failure `resolveGroupAddressing` can return carries a code, so a client
 * picks its own copy instead of rendering the invariant sentence. The prose
 * stays on `detail` as the fallback for a client that does not know the code,
 * so each case asserts both.
 *
 * Two facts reach the client here. Either the roster has nobody who can answer
 * (`group-has-no-responder`), or the client named something the server no
 * longer holds (`stale-view`) — a bot that left, a message that is gone, or a
 * message that a history restore rewrote under the same id.
 */

const BOSS_ID = BotId.make("bot-boss");

const SPECIALIST_ID = BotId.make("bot-specialist");

const GROUP_ID = "group-product";

const BOT_MESSAGE = MessageId.make("message-bot");

const USER_MESSAGE = MessageId.make("message-user");

const UNLABELLED_MESSAGE = MessageId.make("message-unlabelled");

const BOSS_MEMBER: GroupMembership = { kind: "bot", botId: BOSS_ID, role: "boss" };

const SPECIALIST_MEMBER: GroupMembership = {
  kind: "bot",
  botId: SPECIALIST_ID,
  role: "specialist",
};

const resolve = (input: {
  readonly members?: ReadonlyArray<GroupMembership>;
  readonly bossBotId?: BotId | null;
  readonly addressing: GroupAddressing;
  readonly inactive?: ReadonlyArray<BotId>;
}) =>
  resolveGroupAddressing({
    group: {
      id: GROUP_ID,
      members: input.members ?? [BOSS_MEMBER, SPECIALIST_MEMBER],
      bossBotId: input.bossBotId === undefined ? BOSS_ID : input.bossBotId,
    },
    messages: [
      { id: BOT_MESSAGE, role: "assistant", respondingBotId: SPECIALIST_ID },
      { id: USER_MESSAGE, role: "user", respondingBotId: null },
      { id: UNLABELLED_MESSAGE, role: "assistant", respondingBotId: null },
    ],
    addressing: input.addressing,
    isActive: (botId) => !(input.inactive ?? []).includes(botId),
  });

/** The refusal a resolution carries, or a failure when it unexpectedly succeeded. */
const refusalOf = (resolution: ReturnType<typeof resolve>) => {
  if (resolution.ok) throw new Error("Expected the addressing to be refused");

  return { refusal: resolution.refusal, detail: resolution.detail };
};

describe("resolveGroupAddressing refusals", () => {
  // ------------------------------------------------ group-has-no-responder (3)

  it("codes an auto send to a space with no boss", () => {
    const { refusal, detail } = refusalOf(
      resolve({ bossBotId: null, addressing: { kind: "auto" } }),
    );

    expect(refusal).toBe("group-has-no-responder");
    expect(detail).toContain("has no boss bot that can respond");
  });

  it("codes an auto send to a space whose boss is no longer active", () => {
    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "auto" }, inactive: [BOSS_ID] }),
    );

    // The boss is still named on the roster, so the remedy is not "set a boss"
    // alone — but the space still has nobody to answer, which is the same fact.
    expect(refusal).toBe("group-has-no-responder");
    expect(detail).toContain("has no boss bot that can respond");
  });

  it("codes an everyone send to a space with no active bot at all", () => {
    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "everyone" }, inactive: [BOSS_ID, SPECIALIST_ID] }),
    );

    expect(refusal).toBe("group-has-no-responder");
    expect(detail).toContain("has no boss bot that can respond");
  });

  it("codes a bots send that names nobody, which falls back to the boss", () => {
    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "bots", botIds: [] }, bossBotId: null }),
    );

    expect(refusal).toBe("group-has-no-responder");
    expect(detail).toContain("has no boss bot that can respond");
  });

  // ---------------------------------------------------------- stale-view (3)

  it("codes a mention of a bot the space no longer holds", () => {
    const stranger = BotId.make("bot-stranger");

    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "bots", botIds: [SPECIALIST_ID, stranger] } }),
    );

    // The client offered a roster the server has moved past.
    expect(refusal).toBe("stale-view");
    expect(detail).toContain(stranger);
  });

  it("codes a reply to a message that does not exist", () => {
    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "reply", messageId: MessageId.make("message-missing") } }),
    );

    expect(refusal).toBe("stale-view");
    expect(detail).toContain("does not exist in this chat");
  });

  it("codes a reply to a message no bot wrote", () => {
    for (const messageId of [USER_MESSAGE, UNLABELLED_MESSAGE]) {
      const { refusal, detail } = refusalOf(resolve({ addressing: { kind: "reply", messageId } }));

      // A history restore can rewrite a message under the id the client quoted,
      // so this is the stale picture too, not a shape the server merely allows.
      expect(refusal).toBe("stale-view");
      expect(detail).toContain("was not written by a bot");
    }
  });

  it("codes a reply to a bot that left the space", () => {
    const { refusal, detail } = refusalOf(
      resolve({ addressing: { kind: "reply", messageId: BOT_MESSAGE }, inactive: [SPECIALIST_ID] }),
    );

    expect(refusal).toBe("stale-view");
    expect(detail).toContain(SPECIALIST_ID);
  });

  // ------------------------------------------------------------- no prose leak

  it("keeps the sentence on detail for a client that does not know the code", () => {
    const { detail } = refusalOf(resolve({ bossBotId: null, addressing: { kind: "auto" } }));

    // Older clients render `detail` verbatim; it must stay a whole sentence.
    expect(detail).toBe(`Group '${GROUP_ID}' has no boss bot that can respond.`);
  });
});
