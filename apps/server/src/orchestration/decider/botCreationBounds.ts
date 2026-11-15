import { type BotId, type OrchestrationBot } from "@isnadi/contracts";

/**
 * How many bots one creator chain may hold at once.
 *
 * Measured per creator-chain ROOT, not per space, because a bot can create a bot with no space at
 * all: `IsnadiDelegationControls.create` dispatches `groupId: parentThread.groupId ?? null`, so a
 * bot in a plain one-to-one chat creates into no space. A per-space count would be absent exactly
 * where there is no space to count.
 *
 * Five is the shape the flow needs and no more: a boss assembling its own team is the case this
 * must not break, and a squad is a boss plus a handful of specialists. The threat read is blunt
 * about the other direction — a cap of a hundred is not a control, only a longer loop — and each
 * bot made here runs on the user's credentials and spends the user's tokens.
 */
export const ISNADI_BOT_CREATION_MAX_PER_CHAIN_ROOT = 5;

/**
 * How deep a bot-made chain may run: a person makes a bot, that bot makes a bot, and so on.
 *
 * Separate from the breadth ceiling because they bound different shapes. Breadth alone lets one
 * chain spend the whole allowance; depth alone is not a control at all, since depth 3 with
 * unbounded breadth is still unbounded. Depth 3 stops the exponential case — bot makes bot makes
 * bot — while leaving room for a boss that hires a lead who hires a specialist.
 */
export const ISNADI_BOT_CREATION_MAX_CHAIN_DEPTH = 3;

/** Stops a corrupt or hostile chain from costing an unbounded walk; far past either ceiling. */
const MAX_WALK_STEPS = 64;

export interface BotCreationChain {
  /**
   * The top of the chain that survives in the read model: a bot a person made, or the last bot
   * whose own creator is gone. Two creations under the same root share one breadth allowance.
   */
  readonly rootId: BotId;
  /**
   * Hops from the root down to the creator. 0 when a person made the creator, so a bot it creates
   * sits at depth 1.
   */
  readonly creatorDepth: number;
}

/**
 * Walks up from `creatorBotId` to the top of its chain.
 *
 * A missing link does NOT reset the count to zero: `createdByBotId` is one hop, and a creator's
 * creator can be archived away or deleted. The walk stops at the first bot it cannot find and
 * calls that id the root, so the surviving prefix is still measured — otherwise a bot could
 * shorten its own chain by having an ancestor deleted. A cycle cannot occur through legitimate
 * commands, but a corrupt log must not hang the decider, so a revisit ends the walk too.
 */
export function walkBotCreationChain(
  bots: ReadonlyArray<OrchestrationBot>,
  creatorBotId: BotId,
): BotCreationChain {
  const byId = new Map<BotId, OrchestrationBot>(bots.map((bot) => [bot.id, bot]));
  const visited = new Set<BotId>();

  let currentId: BotId = creatorBotId;
  let depth = 0;

  for (let step = 0; step < MAX_WALK_STEPS; step += 1) {
    const current = byId.get(currentId);

    if (current === undefined || visited.has(currentId)) {
      return { rootId: currentId, creatorDepth: depth };
    }

    visited.add(currentId);

    if (current.createdByBotId === null) {
      return { rootId: current.id, creatorDepth: depth };
    }

    currentId = current.createdByBotId;
    depth += 1;
  }

  return { rootId: currentId, creatorDepth: depth };
}

/**
 * The bot-created bots that already hang off the same chain root as `creatorBotId`, which is what
 * the breadth ceiling counts.
 *
 * Only live bots count: the bound is on spend, and an archived bot does not run. A bot has no tool
 * that archives one, so it cannot retire its own creations to refill the allowance — only the user
 * can, which is the user exercising the authority this ceiling defers to.
 */
export function botCreatedBotsUnderRoot(
  bots: ReadonlyArray<OrchestrationBot>,
  creatorBotId: BotId,
): ReadonlyArray<OrchestrationBot> {
  const { rootId } = walkBotCreationChain(bots, creatorBotId);

  return bots.filter((bot) => {
    if (bot.createdByBotId === null || bot.archivedAt !== null) return false;

    return walkBotCreationChain(bots, bot.createdByBotId).rootId === rootId;
  });
}
