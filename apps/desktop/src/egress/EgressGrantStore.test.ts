import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { EgressRefused, openEgressTarget } from "./EgressDialer.ts";
import * as EgressGrantStore from "./EgressGrantStore.ts";

const exact = (host: string) => ({ kind: "exact" as const, host });

const suffix = (domain: string) => ({ kind: "suffix" as const, domain });

const permissionDenied = (method: string) =>
  PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method });

const withStore = <A, E, R extends FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope>(
  body: (input: {
    readonly store: EgressGrantStore.DesktopEgressGrants["Service"];
    readonly grantsPath: string;
    readonly fileSystem: FileSystem.FileSystem;
  }) => Effect.Effect<A, E, R>,
  options: {
    readonly seed?: string;
    /** The grants file goes one directory deeper, so a write creates its directory. */
    readonly subdirectory?: string;
    /** Wraps the real file system, so a test can make one call fail. */
    readonly wrapFileSystem?: (fileSystem: FileSystem.FileSystem) => FileSystem.FileSystem;
  } = {},
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const parent = options.subdirectory ? path.join(directory, options.subdirectory) : directory;
    const grantsPath = path.join(parent, "egress-grants.json");

    if (options.seed !== undefined) {
      yield* fileSystem.makeDirectory(parent, { recursive: true });
      yield* fileSystem.writeFileString(grantsPath, options.seed);
    }

    const store = yield* EgressGrantStore.make(grantsPath).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        options.wrapFileSystem ? options.wrapFileSystem(fileSystem) : fileSystem,
      ),
    );

    return yield* body({ store, grantsPath, fileSystem });
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const INSTANCE = "primary";

describe("DesktopEgressGrants", () => {
  it.effect("denies everything by default", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        assert.strictEqual(yield* store.status, "ready");
        assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("a granted host is allowed only for a profile in the binding", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", exact("Example.com."));
        yield* store.setBinding(INSTANCE, ["p"]);

        const policy = store.policyFor(INSTANCE);

        assert.isTrue(policy.allows("p", "example.com"));
        assert.isTrue(policy.allows("p", "EXAMPLE.com."));
        assert.isFalse(policy.allows("p", "other.com"));
        assert.isFalse(policy.allows("q", "example.com"));
        assert.isFalse(store.policyFor("another-backend").allows("p", "example.com"));
      }),
    ),
  );

  it.effect("a profile outside the binding is refused even when it holds a grant", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", exact("example.com"));
        yield* store.setBinding(INSTANCE, ["someone-else"]);

        assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("a wildcard matches the apex and subdomains on a label boundary only", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", suffix("example.com"));
        yield* store.setBinding(INSTANCE, ["p"]);

        const policy = store.policyFor(INSTANCE);

        assert.isTrue(policy.allows("p", "example.com"));
        assert.isTrue(policy.allows("p", "api.example.com"));
        assert.isTrue(policy.allows("p", "a.b.example.com"));
        assert.isTrue(policy.allows("p", "API.Example.COM."));
        assert.isFalse(policy.allows("p", "evil-example.com"));
        assert.isFalse(policy.allows("p", "example.com.evil.com"));
        assert.isFalse(policy.allows("p", "notexample.com"));
      }),
    ),
  );

  it.effect("a wildcard never matches an IP literal", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", suffix("example.com"));
        yield* store.setBinding(INSTANCE, ["p"]);

        assert.isFalse(store.policyFor(INSTANCE).allows("p", "93.184.216.34"));
      }),
    ),
  );

  it.effect("refuses public suffixes, single labels and IP-shaped wildcards", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        for (const domain of ["com", "co.uk", "localhost", "127.0.0.1", "1234", "::1"]) {
          const error = yield* Effect.flip(store.grant("p", suffix(domain)));

          assert.strictEqual(error._tag, "EgressGrantInvalid", domain);
        }

        assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("refuses a wildcard on a private suffix but still accepts the exact host", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        // One wildcard on `github.io` would cover every unrelated site hosted there.
        for (const domain of ["github.io", "blogspot.com"]) {
          const error = yield* Effect.flip(store.grant("p", suffix(domain)));

          const reason = Predicate.isTagged(error, "EgressGrantInvalid")
            ? error.reason
            : error._tag;

          assert.strictEqual(reason, "public-suffix", domain);
        }

        yield* store.grant("p", exact("foo.github.io"));
        yield* store.setBinding(INSTANCE, ["p"]);

        const policy = store.policyFor(INSTANCE);

        assert.isTrue(policy.allows("p", "foo.github.io"));
        assert.isFalse(policy.allows("p", "bar.github.io"));

        // Only the wildcard is refused. The bare suffix host is still a host the owner can name.
        yield* store.grant("p", exact("github.io"));

        assert.isTrue(policy.allows("p", "github.io"));
      }),
    ),
  );

  it.effect("persists with mode 0600 and survives a reload", () =>
    withStore(({ store, grantsPath, fileSystem }) =>
      Effect.gen(function* () {
        yield* store.setBinding(INSTANCE, ["p"]);
        yield* store.grant("p", exact("example.com"));

        const info = yield* fileSystem.stat(grantsPath);

        assert.strictEqual(info.mode & 0o777, 0o600);

        const reloaded = yield* EgressGrantStore.make(grantsPath);

        assert.isTrue(reloaded.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("creates the grants directory 0700 and opens the temp file 0600", () => {
    const modes: Array<number | undefined> = [];

    return withStore(
      ({ store, grantsPath, fileSystem }) =>
        Effect.gen(function* () {
          const path = yield* Path.Path;

          yield* store.setBinding(INSTANCE, ["p"]);

          const directory = yield* fileSystem.stat(path.dirname(grantsPath));

          assert.strictEqual(directory.mode & 0o777, 0o700);
          assert.deepStrictEqual(modes, [0o600]);
        }),
      {
        subdirectory: "grants",
        wrapFileSystem: (fileSystem) => ({
          ...fileSystem,
          open: (filePath, openOptions) =>
            fileSystem
              .open(filePath, openOptions)
              .pipe(Effect.tap(() => Effect.sync(() => modes.push(openOptions?.mode)))),
        }),
      },
    );
  });

  it.effect("a corrupt file denies everything, is left untouched and refuses writes", () =>
    withStore(
      ({ store, grantsPath, fileSystem }) =>
        Effect.gen(function* () {
          assert.strictEqual(yield* store.status, "unreadable");
          assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));

          const error = yield* Effect.flip(store.grant("p", exact("example.com")));

          assert.strictEqual(error._tag, "EgressGrantStoreUnreadable");
          assert.strictEqual(yield* fileSystem.readFileString(grantsPath), "{not json");

          yield* store.reset;

          assert.strictEqual(yield* store.status, "ready");

          yield* store.setBinding(INSTANCE, ["p"]);
          yield* store.grant("p", exact("example.com"));

          assert.isTrue(store.policyFor(INSTANCE).allows("p", "example.com"));
        }),
      { seed: "{not json" },
    ),
  );

  it.effect("a read error that is not NotFound is unreadable, never an empty store", () =>
    withStore(
      ({ store, grantsPath, fileSystem }) =>
        Effect.gen(function* () {
          // A file we cannot see might hold grants. Treating it as empty would deny every host
          // silently and overwrite it on the next grant.
          assert.strictEqual(yield* store.status, "unreadable");
          assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));

          const error = yield* Effect.flip(store.grant("p", exact("example.com")));

          assert.strictEqual(error._tag, "EgressGrantStoreUnreadable");
          assert.isFalse(yield* fileSystem.exists(grantsPath));
        }),
      {
        wrapFileSystem: (fileSystem) => ({
          ...fileSystem,
          readFileString: () => Effect.fail(permissionDenied("readFileString")),
        }),
      },
    ),
  );

  it.effect("drops a stored grant the rules now refuse, and still lets revoke name it", () =>
    withStore(
      ({ store, grantsPath, fileSystem }) =>
        Effect.gen(function* () {
          // `co.uk` passed an older entry check. It must not survive a load, or a tightened rule
          // would still be honoured from disk.
          assert.strictEqual(yield* store.status, "ready");
          assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.co.uk"));
          assert.isTrue(store.policyFor(INSTANCE).allows("p", "kept.com"));

          // Revoke normalizes and never validates, so naming a grant the entry check refuses is a
          // no-op instead of stranding the owner with a grant no control can remove.
          yield* store.revoke("p", suffix("co.uk"));

          yield* store.grant("p", exact("added.com"));

          assert.notInclude(yield* fileSystem.readFileString(grantsPath), "co.uk");
        }),
      {
        seed: JSON.stringify({
          version: 1,
          bindings: { primary: ["p"] },
          grants: {
            p: [
              { kind: "suffix", domain: "co.uk" },
              { kind: "exact", host: "kept.com" },
            ],
          },
        }),
      },
    ),
  );

  it.effect("a failed rename keeps the old file and the old in-memory grants", () =>
    withStore(({ store, grantsPath, fileSystem }) =>
      Effect.gen(function* () {
        yield* store.setBinding(INSTANCE, ["p"]);
        yield* store.grant("p", exact("example.com"));

        const before = yield* fileSystem.readFileString(grantsPath);

        const failing = yield* EgressGrantStore.make(grantsPath).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fileSystem,
            rename: () => Effect.fail(permissionDenied("rename")),
          }),
        );

        const error = yield* Effect.flip(failing.grant("p", exact("added.com")));

        assert.strictEqual(error._tag, "EgressGrantWriteError");
        assert.strictEqual(yield* fileSystem.readFileString(grantsPath), before);
        assert.isFalse(failing.policyFor(INSTANCE).allows("p", "added.com"));
        assert.isTrue(failing.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("a failed fsync keeps the old file and the old in-memory grants", () =>
    withStore(({ store, grantsPath, fileSystem }) =>
      Effect.gen(function* () {
        yield* store.setBinding(INSTANCE, ["p"]);
        yield* store.grant("p", exact("example.com"));

        const before = yield* fileSystem.readFileString(grantsPath);

        // The bytes reached the kernel but never the disk. Renaming anyway would put a file on
        // disk whose only copy is in the page cache, so the write has to fail instead.
        const failing = yield* EgressGrantStore.make(grantsPath).pipe(
          Effect.provideService(FileSystem.FileSystem, {
            ...fileSystem,
            // Every handle the store opens writes and then never syncs.
            open: (filePath, openOptions) =>
              fileSystem.open(filePath, openOptions).pipe(
                Effect.map(
                  (file): FileSystem.File => ({
                    [FileSystem.FileTypeId]: FileSystem.FileTypeId,
                    stat: file.stat,
                    seek: (offset, from) => file.seek(offset, from),
                    sync: Effect.fail(permissionDenied("sync")),
                    read: (buffer) => file.read(buffer),
                    readAlloc: (size) => file.readAlloc(size),
                    truncate: (length) => file.truncate(length),
                    write: (buffer) => file.write(buffer),
                    writeAll: (buffer) => file.writeAll(buffer),
                  }),
                ),
              ),
          }),
        );

        const error = yield* Effect.flip(failing.grant("p", exact("added.com")));

        assert.strictEqual(
          Predicate.isTagged(error, "EgressGrantWriteError") ? error.operation : error._tag,
          "sync-temporary-file",
        );
        assert.strictEqual(yield* fileSystem.readFileString(grantsPath), before);
        assert.isFalse(failing.policyFor(INSTANCE).allows("p", "added.com"));
        assert.isTrue(failing.policyFor(INSTANCE).allows("p", "example.com"));
      }),
    ),
  );

  it.effect("a revoke removes the grant and publishes the revocation", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.setBinding(INSTANCE, ["p"]);
        yield* store.grant("p", exact("example.com"));

        const watching = yield* Deferred.make<void>();

        const received = yield* Effect.gen(function* () {
          const subscription = yield* store.subscribe;

          yield* Deferred.succeed(watching, undefined);

          return yield* Stream.fromSubscription(subscription).pipe(
            Stream.take(1),
            Stream.runCollect,
          );
        }).pipe(Effect.scoped, Effect.forkChild);

        yield* Deferred.await(watching);
        yield* store.revoke("p", exact("example.com"));

        const revocations = yield* Fiber.join(received);

        assert.isFalse(store.policyFor(INSTANCE).allows("p", "example.com"));
        assert.deepStrictEqual(revocations, [{ profileId: "p", host: "example.com" }]);
      }),
    ),
  );

  it.effect("a revocation published before anything watches is still delivered", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.setBinding(INSTANCE, ["p"]);

        // The subscription is sealed first, the way the runner takes it before any stream can
        // open. A lazily subscribing stream would drop this revocation on the floor.
        const revocations = yield* Effect.scoped(
          Effect.gen(function* () {
            const subscription = yield* store.subscribe;

            yield* store.setBinding(INSTANCE, []);

            return yield* Stream.fromSubscription(subscription).pipe(
              Stream.take(1),
              Stream.runCollect,
            );
          }),
        );

        assert.deepStrictEqual(revocations, [{ profileId: "p" }]);
      }),
    ),
  );
});

describe("the dialer with the grant store", () => {
  const dial = (
    store: EgressGrantStore.DesktopEgressGrants["Service"],
    profileId: string,
    host: string,
    address: string,
  ) => {
    const calls = { resolve: 0, connect: 0 };

    const result = openEgressTarget(
      { host, port: 443, profileId },
      {
        resolve: () =>
          Effect.sync(() => {
            calls.resolve += 1;

            return [address];
          }),
        connect: (target) =>
          Effect.sync(() => {
            calls.connect += 1;

            return target;
          }),
        hostPolicy: store.policyFor(INSTANCE),
        interfaces: () => [],
      },
    ).pipe(
      Effect.flip,
      Effect.map((error: EgressRefused) => error.reason),
    );

    return { calls, result };
  };

  it.effect("a profile outside the binding is refused before any DNS or TCP", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", exact("example.com"));
        yield* store.setBinding(INSTANCE, ["someone-else"]);

        const { calls, result } = dial(store, "p", "example.com", "93.184.216.34");

        assert.strictEqual(yield* result, "host-not-granted");
        assert.deepStrictEqual(calls, { resolve: 0, connect: 0 });
      }),
    ),
  );

  it.effect("a wildcard-granted subdomain that resolves to a private address is blocked", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", suffix("example.com"));
        yield* store.setBinding(INSTANCE, ["p"]);

        const { calls, result } = dial(store, "p", "intranet.example.com", "10.0.0.5");

        assert.strictEqual(yield* result, "blocked-address");
        assert.strictEqual(calls.connect, 0);
      }),
    ),
  );

  it.effect("a granted host that resolves to a public address connects once", () =>
    withStore(({ store }) =>
      Effect.gen(function* () {
        yield* store.grant("p", suffix("example.com"));
        yield* store.setBinding(INSTANCE, ["p"]);

        const calls = { resolve: 0, connect: [] as Array<string> };

        yield* openEgressTarget(
          { host: "api.example.com", port: 443, profileId: "p" },
          {
            resolve: () =>
              Effect.sync(() => {
                calls.resolve += 1;

                return ["93.184.216.34"];
              }),
            connect: (target) =>
              Effect.sync(() => {
                calls.connect.push(target.host);

                return target;
              }),
            hostPolicy: store.policyFor(INSTANCE),
            interfaces: () => [],
          },
        );

        assert.strictEqual(calls.resolve, 1);
        assert.deepStrictEqual(calls.connect, ["93.184.216.34"]);
      }),
    ),
  );
});
