import * as NodeServices from "@effect/platform-node/NodeServices";

import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@isnadi/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";

import * as Schema from "effect/Schema";
import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";
import * as DesktopSavedEnvironments from "../DesktopSavedEnvironments.ts";

export const textDecoder = new TextDecoder();

export const textEncoder = new TextEncoder();

export const savedRegistryRecord: PersistedSavedEnvironmentRecord = {
  environmentId: EnvironmentId.make("environment-1"),
  label: "Remote environment",
  httpBaseUrl: "https://remote.example.com/",
  wsBaseUrl: "wss://remote.example.com/",
  createdAt: "2026-04-09T00:00:00.000Z",
  lastConnectedAt: "2026-04-09T01:00:00.000Z",
  desktopSsh: {
    alias: "devbox",
    hostname: "devbox.example.com",
    username: "julius",
    port: 22,
  },
};

export const SavedEnvironmentRegistryDocumentProbe = Schema.Struct({
  version: Schema.Number,
  records: Schema.Array(Schema.Unknown),
});

export const SavedEnvironmentRegistryDocumentProbeJson = Schema.fromJsonString(
  SavedEnvironmentRegistryDocumentProbe,
);

export const decodeSavedEnvironmentRegistryDocumentProbe = Schema.decodeEffect(
  SavedEnvironmentRegistryDocumentProbeJson,
);

export const encodeSavedEnvironmentRegistryDocumentProbe = Schema.encodeEffect(
  SavedEnvironmentRegistryDocumentProbeJson,
);

export function makeSafeStorageLayer(input: {
  readonly available: boolean;
  readonly availabilityError?: unknown;
  readonly encryptError?: unknown;
  readonly decryptError?: unknown;
}) {
  return Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
    isEncryptionAvailable:
      input.availabilityError === undefined
        ? Effect.succeed(input.available)
        : Effect.fail(
            new ElectronSafeStorage.ElectronSafeStorageAvailabilityError({
              cause: input.availabilityError,
            }),
          ),
    encryptString: (value) =>
      input.encryptError === undefined
        ? Effect.succeed(textEncoder.encode(`enc:${value}`))
        : Effect.fail(
            new ElectronSafeStorage.ElectronSafeStorageEncryptError({
              cause: input.encryptError,
            }),
          ),
    decryptString: (value) => {
      if (input.decryptError !== undefined) {
        return Effect.fail(
          new ElectronSafeStorage.ElectronSafeStorageDecryptError({
            cause: input.decryptError,
          }),
        );
      }

      const decoded = textDecoder.decode(value);

      if (!decoded.startsWith("enc:")) {
        return Effect.fail(
          new ElectronSafeStorage.ElectronSafeStorageDecryptError({
            cause: new Error("invalid secret"),
          }),
        );
      }

      return Effect.succeed(decoded.slice("enc:".length));
    },
    selectedStorageBackend: Effect.succeed(Option.none()),
  } satisfies ElectronSafeStorage.ElectronSafeStorage["Service"]);
}

const notFound = (method: string, path: string) =>
  PlatformError.systemError({
    _tag: "NotFound",
    module: "FileSystem",
    method,
    pathOrDescriptor: path,
  });

/**
 * A path that exists only inside the in-memory file system below. The environment layer derives
 * every path it hands out from this one; nothing is ever created on disk.
 */
const inMemoryBaseDir = "/isnadi-desktop-saved-environments-test";

/**
 * A file system that keeps the saved-environment registry in a `Map`. Every store method reads the
 * registry and rewrites it through a temporary file, and on a saturated pool that real round trip
 * is the wait that outlasts vitest's 5s default. The change path still runs in full - makeDirectory,
 * write, rename, remove - it just reaches no disk. Durability has its own test on the real file
 * system; see `withSavedEnvironments`'s `fileSystem` option.
 */
export function makeInMemoryFileSystem(): FileSystem.FileSystem {
  const files = new Map<string, string>();

  return FileSystem.makeNoop({
    makeDirectory: () => Effect.void,
    exists: (path) => Effect.sync(() => files.has(path)),
    readFileString: (path) =>
      Effect.sync(() => files.get(path)).pipe(
        Effect.flatMap((contents) =>
          Option.match(Option.fromNullishOr(contents), {
            onNone: () => Effect.fail(notFound("readFileString", path)),
            onSome: (value) => Effect.succeed(value),
          }),
        ),
      ),
    writeFileString: (path, data) =>
      Effect.sync(() => {
        files.set(path, data);
      }),
    rename: (fromPath, toPath) =>
      Effect.sync(() => files.get(fromPath)).pipe(
        Effect.flatMap((contents) =>
          Option.match(Option.fromNullishOr(contents), {
            onNone: () => Effect.fail(notFound("rename", fromPath)),
            onSome: (value) =>
              Effect.sync(() => {
                files.delete(fromPath);
                files.set(toPath, value);
              }),
          }),
        ),
      ),
    remove: (path) =>
      Effect.sync(() => {
        files.delete(path);
      }),
  });
}

export function makeLayer(
  baseDir: string,
  options?: {
    readonly availableSecretStorage?: boolean;
    readonly availabilityError?: unknown;
    readonly encryptError?: unknown;
    readonly decryptError?: unknown;
  },
  fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = NodeServices.layer,
) {
  const environmentLayer = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ ISNADI_HOME: baseDir })),
    ),
  );

  const safeStorageLayer = makeSafeStorageLayer({
    available: options?.availableSecretStorage ?? true,
    availabilityError: options?.availabilityError,
    encryptError: options?.encryptError,
    decryptError: options?.decryptError,
  });

  const dependencies = Layer.mergeAll(
    environmentLayer,
    safeStorageLayer,
    NodeServices.layer,
    fileSystemLayer,
  );

  return DesktopSavedEnvironments.layer.pipe(Layer.provideMerge(dependencies));
}

export const withSavedEnvironments = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopSavedEnvironments.DesktopSavedEnvironments>,
  options?: {
    readonly availableSecretStorage?: boolean;
    readonly availabilityError?: unknown;
    readonly encryptError?: unknown;
    readonly decryptError?: unknown;
    /**
     * `"memory"` (the default) runs the store's read, write and rename round trip over a `Map`.
     * `"disk"` keeps a real temporary directory, for the tests that assert durability.
     */
    readonly fileSystem?: "memory" | "disk";
  },
) =>
  Effect.gen(function* () {
    const { fileSystem: mode = "memory", ...secretOptions } = options ?? {};

    if (mode === "disk") {
      const fileSystem = yield* FileSystem.FileSystem;

      const baseDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-saved-environments-test-",
      });

      return yield* effect.pipe(Effect.provide(makeLayer(baseDir, secretOptions)));
    }

    return yield* effect.pipe(
      Effect.provide(
        makeLayer(
          inMemoryBaseDir,
          secretOptions,
          Layer.succeed(FileSystem.FileSystem, makeInMemoryFileSystem()),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
