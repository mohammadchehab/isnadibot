import type { LinkCheckBrokenLink } from "@isnadi/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

import { isInternalTarget } from "./fixPlan.ts";
import { linkKey, resolvePageAddress } from "./sitePages.ts";

/** A link that answered with a redirect, and the address it finally landed on. */
export interface RedirectAnswer {
  readonly key: string;
  readonly location: string;
}

/**
 * Follows a redirect chain to its end. A report says a link answered 3xx but not
 * where it pointed, and a repair that guessed the destination would be worse
 * than no repair, so the address has to be asked for.
 */
export class RedirectResolver extends Context.Service<
  RedirectResolver,
  {
    readonly resolve: (url: string) => Effect.Effect<string | null>;
  }
>()("isnadibot/link-monitor/RedirectResolver") {}

/** How many hops a chain may take before the fixer gives up on it. */
export const MAX_REDIRECT_HOPS = 5;

/** True when a report says this link redirected rather than failed. */
export function isRedirectStatus(link: LinkCheckBrokenLink): boolean {
  return link.status !== null && link.status >= 300 && link.status < 400;
}

/**
 * Every redirecting link in the report, paired with where it landed. Links that
 * are not redirects are skipped without a request, and a chain that fails to
 * resolve is left out so the planner reports the link instead of repairing it.
 */
export const resolveReportRedirects = Effect.fn("linkMonitor.resolveReportRedirects")(
  function* (input: {
    readonly siteUrl: string;
    readonly links: ReadonlyArray<LinkCheckBrokenLink>;
  }) {
    const resolver = yield* RedirectResolver;
    const answers = new Map<string, string>();

    for (const link of input.links) {
      if (!isRedirectStatus(link) || !isInternalTarget(link.targetUrl)) continue;

      const address = resolvePageAddress(link.sourcePage, link.targetUrl);
      const location = yield* resolver.resolve(address);

      if (location !== null) answers.set(linkKey(link), location);
    }

    return answers;
  },
);

/**
 * The live resolver: one request per address, redirects followed by hand so a
 * chain can be capped and a link that leaves the site after several hops is
 * still reported as the address it landed on.
 */
export const redirectResolverLive = (
  request: (url: string) => Promise<{ readonly status: number; readonly location: string | null }>,
): RedirectResolver["Service"] => ({
  resolve: (url) =>
    Effect.tryPromise({
      try: async () => {
        let current = url;

        for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
          const response = await request(current);

          // The chain ended where the last redirect said; the first answer is the
          // address the report already knows about, so it is nothing new.
          if (response.location === null) return hop === 0 ? null : current;

          current = new URL(response.location, current).toString();
        }

        return null;
      },
      // A chain nobody answers is one the planner reports, not an error that ends the run.
      catch: () => null,
    }).pipe(Effect.orElseSucceed(() => null)),
});
