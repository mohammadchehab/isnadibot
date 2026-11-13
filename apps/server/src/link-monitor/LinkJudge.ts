/**
 * Judges one link the way a reader would reach it.
 *
 * An internal link is looked up in the docs source; an external one is asked
 * over the network. Nothing here decides what to do with a broken link: it says
 * which target failed and why, and a run assembles the report.
 */
import type { LinkCheckBrokenLink } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpClient } from "effect/unstable/http";

import type { DocsSource } from "./DocsSource.ts";
import { headingAnchors } from "./MarkdownLinks.ts";

export const LINK_CHECK_TIMEOUT_MS = 10_000;

/** What asking a live URL produced. `ok` is the only answer a link survives. */
type ExternalOutcome = "ok" | "http-error" | "network-error" | "timeout";

export interface LinkJudge {
  /** Judges one link found on `page`, which is repository-relative. */
  readonly judge: (
    page: string,
    target: string,
    timeoutMs?: number,
  ) => Effect.Effect<LinkCheckBrokenLink | null, never>;
}

/**
 * Builds a judge for one run. Both of its memories outlive a single link: a
 * page's headings are read once however many links point into it, and a URL is
 * asked once however many pages link to it.
 */
export const makeLinkJudge = (
  source: DocsSource,
): Effect.Effect<LinkJudge, never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const headings = new Map<string, Effect.Effect<ReadonlySet<string>, never>>();
    const externals = new Map<string, Effect.Effect<ExternalOutcome, never>>();

    const headingsOf = (page: string): Effect.Effect<ReadonlySet<string>, never> => {
      const cached = headings.get(page);

      if (cached !== undefined) return cached;

      const read = Effect.cached(
        source.markdownAt(page).pipe(
          Effect.orElseSucceed(() => null),
          Effect.map((markdown) =>
            markdown === null ? new Set<string>() : headingAnchors(markdown),
          ),
        ),
      ).pipe(Effect.flatten);

      headings.set(page, read);

      return read;
    };

    const ask = (url: string, method: "HEAD" | "GET", timeoutMs: number) => {
      const request = method === "HEAD" ? httpClient.head(url) : httpClient.get(url);

      return request.pipe(
        Effect.map((response): ExternalOutcome => (response.status >= 400 ? "http-error" : "ok")),
        Effect.catchCause(() => Effect.succeed<ExternalOutcome>("network-error")),
        Effect.timeoutOption(timeoutMs),
        Effect.map(Option.getOrElse((): ExternalOutcome => "timeout")),
      );
    };

    const externalOutcome = (url: string, timeoutMs: number) => {
      const key = `${timeoutMs}:${url}`;
      const cached = externals.get(key);

      if (cached !== undefined) return cached;

      const read = Effect.cached(
        Effect.gen(function* () {
          const head = yield* ask(url, "HEAD", timeoutMs);

          if (head === "ok" || head !== "http-error") return head;

          return yield* ask(url, "GET", timeoutMs);
        }),
      ).pipe(Effect.flatten);

      externals.set(key, read);

      return read;
    };

    const anchorVerdict = (anchoredPage: string, page: string, anchor: string, target: string) =>
      Effect.gen(function* () {
        if (anchor === "") return null;

        const anchors = yield* headingsOf(anchoredPage);

        if (anchors.has(anchor.toLowerCase())) return null;

        return broken(page, target, "missing-anchor");
      });

    const judge: LinkJudge["judge"] = (page, target, timeoutMs = LINK_CHECK_TIMEOUT_MS) =>
      Effect.gen(function* () {
        if (skippedScheme(target)) return null;

        if (isExternal(target)) {
          const outcome = yield* externalOutcome(
            target.startsWith("//") ? `https:${target}` : target,
            timeoutMs,
          );

          return outcome === "ok" ? null : broken(page, target, outcome);
        }

        const [pathPart, anchor] = splitAnchor(target);

        if (pathPart === "") return yield* anchorVerdict(page, page, anchor, target);

        const resolved = resolveRepositoryPath(page, pathPart);

        if (resolved === null) return broken(page, target, "missing-file");

        const exists = yield* source.hasFile(resolved).pipe(Effect.orElseSucceed(() => false));

        if (!exists) return broken(page, target, "missing-file");

        return yield* anchorVerdict(resolved, page, anchor, target);
      });

    return { judge } satisfies LinkJudge;
  });

function broken(page: string, target: string, reason: string): LinkCheckBrokenLink {
  return { sourcePage: page, targetUrl: target, status: null, reason };
}

/**
 * The repository-relative path a link on `page` names, or null when it points
 * out of the repository, where nothing can be checked.
 */
export function resolveRepositoryPath(page: string, pathPart: string): string | null {
  const decoded = safeDecode(pathPart) ?? pathPart;
  const parts = decoded.startsWith("/") ? [] : page.split("/").slice(0, -1);

  for (const segment of decoded.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") continue;

    if (segment === "..") {
      if (parts.length === 0) return null;

      parts.pop();

      continue;
    }

    parts.push(segment);
  }

  return parts.join("/");
}

function splitAnchor(target: string): readonly [path: string, anchor: string] {
  const hash = target.indexOf("#");

  if (hash === -1) return [target, ""];

  return [target.slice(0, hash), target.slice(hash + 1)];
}

function isExternal(target: string): boolean {
  return /^https?:\/\//i.test(target) || target.startsWith("//");
}

/** `mailto:` and friends are addresses, not pages, so nothing can be fetched. */
function skippedScheme(target: string): boolean {
  return /^(?:mailto|tel|data|javascript|file):/i.test(target);
}

function safeDecode(pathPart: string): string | null {
  try {
    return decodeURIComponent(pathPart);
  } catch {
    return null;
  }
}
