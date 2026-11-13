import * as NodeFS from "node:fs/promises";
import * as NodeHTTP from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { LINK_CHECK_REPORT_LIMIT, LinkCheckReport } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { FetchHttpClient } from "effect/unstable/http";

import { makeLocalSource } from "./DocsSource.ts";
import { runLinkCheck } from "./RunLinkCheck.ts";

const TestLayer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer);

/** A docs checkout with the given files, in a directory of its own. */
const withDocs = <A, E, R>(
  files: Readonly<Record<string, string>>,
  use: (root: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.promise(async () => {
      const root = await NodeFS.mkdtemp(NodePath.join(NodeOS.tmpdir(), "isnadi-link-monitor-"));

      for (const [name, contents] of Object.entries(files)) {
        const target = NodePath.join(root, name);

        await NodeFS.mkdir(NodePath.dirname(target), { recursive: true });
        await NodeFS.writeFile(target, contents, "utf8");
      }

      return root;
    }),
    use,
    (root) => Effect.promise(() => NodeFS.rm(root, { recursive: true, force: true })),
  );

/** A local HTTP server serving the given path → status, counting what it was asked. */
const withServer = <A, E, R>(
  statuses: Readonly<Record<string, number>>,
  use: (base: string, hits: ReadonlyArray<string>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => {
  const hits: Array<string> = [];
  const server = NodeHTTP.createServer((request, response) => {
    const path = request.url ?? "/";

    hits.push(path);
    response.writeHead(statuses[path] ?? 404);
    response.end();
  });

  return Effect.acquireUseRelease(
    Effect.promise(
      () =>
        new Promise<NodeHTTP.Server>((resolve) => {
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;

      return use(`http://127.0.0.1:${port}`, hits);
    },
    () => Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
};

const run = (root: string, directory = "docs") =>
  Effect.gen(function* () {
    const source = yield* makeLocalSource({ projectRoot: root, directory });

    return yield* runLinkCheck({ source });
  });

describe("runLinkCheck", () => {
  it.effect("reports a missing file and a missing anchor with the page each sits on", () =>
    withDocs(
      {
        "docs/index.md": [
          "# Docs",
          "[guide](guide.md)",
          "[gone](missing.md)",
          "[broken anchor](guide.md#nope)",
          "[good anchor](guide.md#the-guide)",
          "[mail](mailto:team@example.com)",
        ].join("\n"),
        "docs/guide.md": "# The Guide\n\ntext\n",
      },
      (root) =>
        Effect.gen(function* () {
          const report = yield* run(root);

          assert.strictEqual(report.siteUrl, "docs");
          // The mailto: address is not a page, so it is not checked.
          assert.strictEqual(report.checkedCount, 4);
          assert.strictEqual(report.brokenCount, 2);
          assert.deepStrictEqual(
            report.brokenLinks.map((link) => [link.targetUrl, link.reason]),
            [
              ["missing.md", "missing-file"],
              ["guide.md#nope", "missing-anchor"],
            ],
          );
        }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("caps the links it lists but keeps the true total", () =>
    withDocs(
      {
        "docs/index.md": Array.from(
          { length: LINK_CHECK_REPORT_LIMIT + 7 },
          (_, index) => `[page ${index}](missing-${index}.md)`,
        ).join("\n"),
      },
      (root) =>
        Effect.gen(function* () {
          const report = yield* run(root);

          assert.strictEqual(report.brokenCount, LINK_CHECK_REPORT_LIMIT + 7);
          assert.strictEqual(report.brokenLinks.length, LINK_CHECK_REPORT_LIMIT);
        }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("asks a live URL once and reports a 404 as an http error", () =>
    withServer({ "/ok": 200, "/dead": 404 }, (base, hits) =>
      withDocs(
        {
          "docs/a.md": `[ok](${base}/ok)`,
          "docs/b.md": `[dead](${base}/dead)`,
          "docs/c.md": `[dead again](${base}/dead)`,
        },
        (root) =>
          Effect.gen(function* () {
            const report = yield* run(root);

            assert.strictEqual(report.checkedCount, 3);
            assert.strictEqual(report.brokenCount, 2);
            assert.deepStrictEqual(
              report.brokenLinks.map((link) => [link.sourcePage, link.reason]),
              [
                ["b.md", "http-error"],
                ["c.md", "http-error"],
              ],
            );
            // One request per distinct URL: the second page linking to the dead
            // one costs nothing.
            assert.deepStrictEqual(hits, ["/ok", "/dead"]);
          }),
      ),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("fails a run that judged nothing, and names what it walked", () =>
    withDocs({ "docs/empty.md": "# Nothing here\n" }, (root) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(run(root));

        assert.strictEqual(error._tag, "LinkCheckFoundNoLinksError");
        assert.strictEqual(error.site, "docs");
        assert.include(error.message, "1 page(s)");
      }),
    ).pipe(Effect.provide(TestLayer)),
  );

  it.effect("produces a report the contracts schema accepts", () =>
    withDocs(
      { "docs/index.md": "[guide](guide.md)\n[gone](missing.md)\n", "docs/guide.md": "# G\n" },
      (root) =>
        Effect.gen(function* () {
          const report = yield* run(root);
          const decoded = Schema.decodeUnknownSync(LinkCheckReport)(report);

          assert.strictEqual(decoded.checkedCount, 2);
          assert.strictEqual(decoded.brokenCount, 1);
          assert.isTrue(decoded.startedAt <= decoded.finishedAt);
        }),
    ).pipe(Effect.provide(TestLayer)),
  );
});
