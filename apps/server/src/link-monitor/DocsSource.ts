/**
 * Where a link-check run reads its pages from.
 *
 * A customer points the monitor at their docs the way they would point a person
 * at them: a directory in a checkout, or a GitHub link they copied from the
 * address bar. Both become the same `DocsSource`, so the judging half of the
 * monitor never learns which one it got.
 *
 * Every path a source hands back is repository-relative with forward slashes,
 * because a docs page links to its neighbours the same way whichever machine
 * reads it.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

/** One docs page: where it sits in the repository, and its markdown. */
export interface DocsPage {
  /** Repository-relative path, such as `docs/user/bots.md`. */
  readonly path: string;
  readonly markdown: string;
}

export interface DocsSource {
  /** What the report calls what was crawled: a directory, or the URL given. */
  readonly site: string;
  /** Repository-relative directory the walk starts at; `""` is the repository root. */
  readonly directory: string;
  /** Every markdown page under `directory`, at most `maxPages` of them. */
  readonly pages: (maxPages: number) => Effect.Effect<ReadonlyArray<DocsPage>, DocsSourceError>;
  /** The markdown at a repository-relative path, or null when there is none. */
  readonly markdownAt: (path: string) => Effect.Effect<string | null, DocsSourceError>;
  /** Whether a repository-relative path names a file a reader could open. */
  readonly hasFile: (path: string) => Effect.Effect<boolean, DocsSourceError>;
}

/**
 * A source could not be read: the directory is gone, the repository is private,
 * or the network refused. It carries the address it tried so a failed run says
 * which docs it could not reach.
 */
export class DocsSourceError extends Schema.TaggedErrorClass<DocsSourceError>()("DocsSourceError", {
  site: Schema.String,
  message: Schema.String,
}) {}

/** The GitHub coordinates a link in the address bar carries. */
export interface GithubTarget {
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;
  readonly directory: string;
}

const GITHUB_URL =
  /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)(?:\/(?:tree|blob)\/([^/]+)\/(.*?))?\/?$/;

/**
 * Reads `https://github.com/owner/repo/tree/main/docs`, the link a customer
 * pastes, into the pieces the crawler needs. A link to a page crawls the
 * directory that page sits in. Anything that is not a GitHub link is null, and
 * the caller treats it as a local directory.
 */
export function parseGithubTarget(target: string): GithubTarget | null {
  const match = GITHUB_URL.exec(target.trim());

  if (!match) return null;

  const [, owner, repo, ref, rest] = match;

  if (!owner || !repo) return null;

  const path = (rest ?? "").replace(/\.md$/, "");
  const directory = (ref === undefined ? path : path).replace(/\/+$/, "");

  return {
    owner,
    repo: repo.replace(/\.git$/, ""),
    ref: ref ?? "HEAD",
    directory,
  };
}

/**
 * Turns what the user typed into a source: a GitHub link, or a directory in
 * this checkout. `projectRoot` only anchors the local case, so a relative
 * directory resolves the same way from any working directory.
 */
export const docsSourceFromTarget = Effect.fn("link-monitor.docsSource")(function* (
  target: string,
  options: { readonly projectRoot?: string } = {},
) {
  const github = parseGithubTarget(target);

  if (github !== null) {
    const httpClient = yield* HttpClient.HttpClient;

    return makeGithubSource(httpClient, github, target.trim());
  }

  const path = yield* Path.Path;

  return yield* makeLocalSource({
    projectRoot: options.projectRoot ?? ".",
    directory: path.normalize(target),
  });
});

interface LocalSourceInput {
  readonly projectRoot: string;
  /** Absolute, or relative to `projectRoot`. */
  readonly directory: string;
}

/** A docs directory in a checkout on this machine. */
export const makeLocalSource = Effect.fn("link-monitor.localSource")(function* (
  input: LocalSourceInput,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(input.projectRoot, input.directory);
  const site = toPosix(path.relative(path.resolve(input.projectRoot), root)) || ".";

  const absolute = (repositoryPath: string) => path.resolve(root, repositoryPath);

  const markdownAt: DocsSource["markdownAt"] = (repositoryPath) =>
    fileSystem.readFileString(absolute(repositoryPath)).pipe(
      Effect.map((markdown): string | null => markdown),
      Effect.catchCause(() => Effect.succeed(null)),
    );

  return {
    site,
    directory: site,
    pages: (maxPages) => markdownPagesUnder(fileSystem, path, root, maxPages),
    markdownAt,
    hasFile,
  } satisfies DocsSource;
});

/** The pages under `root` in a stable order, read once. */
const markdownPagesUnder = Effect.fn("link-monitor.pagesUnder")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  maxPages: number,
) {
  const found: DocsPage[] = [];
  const queue = [root];

  while (queue.length > 0 && found.length < maxPages) {
    const directory = queue.shift() ?? "";
    const entries = yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));

    for (const entry of [...entries].sort((left, right) => left.localeCompare(right))) {
      const entryPath = path.join(directory, entry);
      const info = yield* fileSystem.stat(entryPath).pipe(Effect.option);

      if (info._tag === "None") continue;

      if (info.value.type === "Directory") {
        queue.push(entryPath);
      } else if (entry.endsWith(".md") && found.length < maxPages) {
        const markdown = yield* fileSystem
          .readFileString(entryPath)
          .pipe(Effect.orElseSucceed(() => ""));

        found.push({ path: toPosix(path.relative(root, entryPath)), markdown });
      }
    }
  }

  return found;
});

const DIRECTORY_SUFFIXES = ["", ".md", "/index.md", "/README.md"];

/**
 * A docs page can be written `user/bots`, `user/bots.md` or `user/`, and all
 * three open the same page on GitHub. Only a page that exists in every reading
 * counts as missing.
 */
const pageCandidates = (repositoryPath: string): ReadonlyArray<string> => {
  const trimmed = repositoryPath.replace(/[?#].*$/, "").replace(/\/+$/, "");

  return DIRECTORY_SUFFIXES.map((suffix) => `${trimmed}${suffix}`).filter(
    (candidate) => candidate !== "",
  );
};

const hasFile = Effect.fn("link-monitor.hasFile")(function* (repositoryPath: string) {
  const fileSystem = yield* FileSystem.FileSystem;

  for (const candidate of pageCandidates(repositoryPath)) {
    const info = yield* fileSystem.stat(candidate).pipe(Effect.option);

    if (info._tag === "Some" && info.value.type === "File") return true;
  }

  return false;
});

const API_ROOT = "https://api.github.com";
const RAW_ROOT = "https://raw.githubusercontent.com";

/** How many raw files one walk reads at once. */
const RAW_CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 15_000;

const GithubTreeEntry = Schema.Struct({
  path: Schema.String,
  type: Schema.String,
});

const GithubTree = Schema.Struct({
  tree: Schema.Array(GithubTreeEntry),
  truncated: Schema.optional(Schema.Boolean),
});

/**
 * A docs directory in a public GitHub repository.
 *
 * One API call lists the repository's files, then each page is read from
 * `raw.githubusercontent.com`, which keeps the run inside the unauthenticated
 * rate limit even on a repository with hundreds of docs pages.
 */
export function makeGithubSource(
  httpClient: HttpClient.HttpClient,
  target: GithubTarget,
  site: string,
): DocsSource {
  const { owner, repo, ref } = target;
  const directory = target.directory.replace(/^\/+|\/+$/g, "");
  const rawUrl = (repositoryPath: string) =>
    `${RAW_ROOT}/${owner}/${repo}/${ref}/${repositoryPath}`;
  const request = (url: string) =>
    httpClient
      .get(url)
      .pipe(Effect.timeout(REQUEST_TIMEOUT_MS), Effect.mapError(toSourceError(site)));

  const readRaw = (repositoryPath: string) =>
    request(rawUrl(repositoryPath)).pipe(
      Effect.flatMap((response) => (response.status === 200 ? response.text : Effect.succeed(""))),
      Effect.catchCause(() => Effect.succeed("")),
      Effect.map((markdown): string | null => (markdown === "" ? null : markdown)),
    );

  const listing = Effect.cached(
    request(`${API_ROOT}/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(GithubTree)),
      Effect.mapError((error) =>
        toSourceError(site)(error instanceof Error ? error : new Error(String(error))),
      ),
    ),
  );

  const inDirectory = (repositoryPath: string) =>
    directory === "" || repositoryPath.startsWith(`${directory}/`);

  return {
    site,
    directory: directory || ".",
    pages: (maxPages) =>
      Effect.gen(function* () {
        const tree = yield* listing;

        const paths = tree.tree
          .filter(
            (entry) =>
              entry.type === "blob" && entry.path.endsWith(".md") && inDirectory(entry.path),
          )
          .map((entry) => entry.path)
          .sort((left, right) => left.localeCompare(right))
          .slice(0, maxPages);

        return yield* Effect.forEach(
          paths,
          (repositoryPath) =>
            readRaw(repositoryPath).pipe(
              Effect.map(
                (markdown): DocsPage => ({
                  path: repositoryPath.slice(directory === "" ? 0 : directory.length + 1),
                  markdown: markdown ?? "",
                }),
              ),
            ),
          { concurrency: RAW_CONCURRENCY },
        );
      }),
    // A page outside the walked directory reads from the repository the same
    // way, so a docs page linking to `../AGENTS.md` is judged, not guessed at.
    markdownAt: (repositoryPath) =>
      readRaw(`${directory === "" ? "" : `${directory}/`}${repositoryPath}`),
    hasFile: (repositoryPath) =>
      Effect.gen(function* () {
        const base = directory === "" ? "" : `${directory}/`;

        for (const candidate of pageCandidates(repositoryPath)) {
          const response = yield* httpClient.head(rawUrl(`${base}${candidate}`)).pipe(
            Effect.timeout(REQUEST_TIMEOUT_MS),
            Effect.catchCause(() => Effect.succeed(null)),
          );

          if (response !== null && response.status === 200) return true;
        }

        return false;
      }),
  };
}

const toSourceError = (site: string) => (error: unknown) =>
  new DocsSourceError({
    site,
    message: error instanceof Error ? error.message : String(error),
  });

function toPosix(path: string): string {
  return path.split("\\").join("/");
}
