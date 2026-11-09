import { BotId, EnvironmentId } from "@isnadi/contracts";
import {
  spaceUsageTurns,
  type SpaceUsageAnswer,
  type SpaceUsageSummary,
} from "@isnadi/client-runtime/space";
import { createBotUsageEnvironmentAtoms } from "@isnadi/client-runtime/state/bot-usage";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { hasTag } from "~/lib/taggedUnion";
import { connectionAtomRuntime } from "../connection/runtime";

// Usage revalidates when the tab becomes visible again, and costs nothing while
// it is hidden.
export const botUsageEnvironment = createBotUsageEnvironmentAtoms(connectionAtomRuntime, {
  focusSignal: Atom.windowFocusSignal,
});

const SpaceUsageKey = Schema.Struct({
  environmentId: EnvironmentId,
  since: Schema.String,
  botIds: Schema.Array(BotId),
});

const decodeSpaceUsageKey = Schema.decodeUnknownSync(SpaceUsageKey);

/**
 * Sums a space's turns over one window by reading each member's own usage query.
 *
 * Keyed by the serialised members and window so repeated renders share one atom,
 * and so each member's query is the same one the bot's usage section already
 * reads.
 */
export const spaceUsageAtom = Atom.family((rawKey: string) =>
  Atom.make((get): SpaceUsageSummary => {
    const key = decodeSpaceUsageKey(JSON.parse(rawKey));

    const answers: SpaceUsageAnswer[] = [];

    for (const botId of key.botIds) {
      const result = get(
        botUsageEnvironment.summary({
          environmentId: key.environmentId,
          input: { botId, since: key.since },
        }),
      );

      if (result.waiting) {
        answers.push({ status: "pending" });
        continue;
      }

      const window = Option.getOrNull(AsyncResult.value(result))?.window;

      // A server that does not report the window cannot answer this tile, and a
      // missing window is not zero turns.
      answers.push(
        hasTag(result, "Failure") || window === undefined
          ? { status: "failed" }
          : { status: "ready", turns: window.turns },
      );
    }

    return spaceUsageTurns(answers);
  }).pipe(Atom.withLabel(`web-bot-usage:space:${rawKey}`)),
);

const EMPTY_USAGE = Atom.make<SpaceUsageSummary>(spaceUsageTurns([])).pipe(
  Atom.withLabel("web-bot-usage:space:none"),
);

/** The atom for a space's Usage tile, or null while the environment is unknown. */
export function spaceUsageOf(
  environmentId: EnvironmentId | null,
  since: string,
  botIds: ReadonlyArray<string>,
): Atom.Atom<SpaceUsageSummary> | null {
  if (!environmentId) return null;

  // Sorted so a roster that reorders does not mint a second atom for the same sum.
  const ordered = [...botIds].sort();

  return spaceUsageAtom(JSON.stringify({ environmentId, since, botIds: ordered }));
}

export function useSpaceUsage(
  environmentId: EnvironmentId | null,
  since: string,
  botIds: ReadonlyArray<string>,
): SpaceUsageSummary {
  // Hooks cannot run conditionally, so an unknown environment reads as an empty
  // space instead of skipping the subscription.
  return useAtomValue(spaceUsageOf(environmentId, since, botIds) ?? EMPTY_USAGE);
}
