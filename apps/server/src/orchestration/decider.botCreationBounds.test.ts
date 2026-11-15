import { BotId, type OrchestrationBot } from "@isnadi/contracts";
import { expect, it } from "@effect/vitest";

import { botCreatedBotsUnderRoot, walkBotCreationChain } from "./decider/botCreationBounds.ts";

const NOW = "2026-08-27T12:00:00.000Z";

/** Only the fields the chain walk reads carry meaning here; the rest is the bot shape. */
function makeBot(id: string, createdByBotId: string | null): OrchestrationBot {
  const botId = BotId.make(id);

  return {
    id: botId,
    name: id,
    title: "Agent",
    label: null,
    description: null,
    disabledMcpServerIds: [],
    skills: [],
    skillRegistryAccess: false,
    avatar: { kind: "dither", seed: botId },
    engine: null,
    sandbox: "local",
    runtimeMode: "full-access",
    imageProvider: null,
    voiceEnabled: true,
    channelBindings: [],
    groupId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    createdByBotId: createdByBotId === null ? null : BotId.make(createdByBotId),
  };
}

it("counts the surviving prefix when an ancestor is missing", () => {
  // `b` was made by a bot that is no longer in the read model. The walk must stop at
  // the missing id and call it the root, so the one hop that survives is still measured.
  // A walk that reset the count on a missing link would report depth 0, and a bot could
  // shorten its own chain by having an ancestor deleted.
  const bots = [makeBot("b", "gone")];

  const chain = walkBotCreationChain(bots, BotId.make("b"));

  expect(chain.creatorDepth).toBe(1);
  expect(chain.rootId).toBe(BotId.make("gone"));
});

it("terminates on a cycle instead of walking forever", () => {
  // No command can build this, but a corrupt log must not hang the decider. The revisit
  // ends the walk at the repeated bot.
  const bots = [makeBot("a", "b"), makeBot("b", "a")];

  const chain = walkBotCreationChain(bots, BotId.make("a"));

  expect(chain.rootId).toBe(BotId.make("a"));
  expect(chain.creatorDepth).toBe(2);
});

it("fails closed at the step bound on a chain longer than the walk allows", () => {
  // A 100-bot chain runs past MAX_WALK_STEPS (64), so the walk stops at the bound rather
  // than reaching the true root. Failing closed means it returns the prefix it measured;
  // the true root is bot-0, and stopping early is what keeps a hostile chain cheap.
  const bots = [
    makeBot("bot-0", null),
    ...Array.from({ length: 99 }, (_, index) => makeBot(`bot-${index + 1}`, `bot-${index}`)),
  ];

  const chain = walkBotCreationChain(bots, BotId.make("bot-99"));

  expect(chain.creatorDepth).toBe(64);
  expect(chain.rootId).not.toBe(BotId.make("bot-0"));
});

it("shares one breadth allowance across a chain whose root is missing", () => {
  // Two bots hang off the same missing ancestor. They must count as one chain, or the
  // ceiling would be per-bot and a bot could refill its allowance by creating siblings.
  // `b` counts too: the filter asks for every bot whose CREATOR walks up to the same root,
  // and `b`'s creator is the missing `gone`, which is that root. So the chain rooted at
  // `gone` holds all three, and the allowance is spent once for the whole group.
  const bots = [makeBot("b", "gone"), makeBot("c", "b"), makeBot("d", "b")];

  const underRoot = botCreatedBotsUnderRoot(bots, BotId.make("b"));

  expect(underRoot.map((bot) => bot.id)).toEqual([
    BotId.make("b"),
    BotId.make("c"),
    BotId.make("d"),
  ]);
});
