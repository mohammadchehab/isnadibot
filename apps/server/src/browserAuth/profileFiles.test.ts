import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

import {
  BROWSER_PROFILES_DIRECTORY,
  BrowserProfileFileError,
  browserProfileCiphertextPath,
  parseBrowserProfileCiphertextFileName,
  reconcileBrowserProfileCiphertext,
  writeBrowserProfileCiphertext,
} from "./profileFiles.ts";
import { BrowserProfileId } from "./profileId.ts";

const ProfileAlpha = BrowserProfileId.make("3f1a1c62-8f4a-4a2c-9c3f-2b0a1d5e7f90");

const ProfileBeta = BrowserProfileId.make("8c2b4d76-1e5f-4b3a-8d6c-0a9e2f4b6c18");

const platformLayer = it.layer(NodeServices.layer);

const ciphertext = new Uint8Array([1, 2, 3, 4]);

const fileMode = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return (yield* fs.stat(path)).mode & 0o777;
  });

const listNames = (directory: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return (yield* fs.readDirectory(directory)).toSorted();
  });

platformLayer("browser profile files", (it) => {
  it.effect("a path is a branded id and a non-negative generation under the state directory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "isnadi-profiles-" });

      assert.strictEqual(
        yield* browserProfileCiphertextPath({ stateDir, profileId: ProfileAlpha, generation: 3 }),
        `${stateDir}/${BROWSER_PROFILES_DIRECTORY}/${ProfileAlpha}.3.enc`,
      );

      // A caller cannot name a file outside the directory, because neither part comes from a request.
      const traversal = yield* Effect.flip(
        browserProfileCiphertextPath({
          stateDir,
          profileId: "../../etc/passwd",
          generation: 0,
        }),
      );

      const negative = yield* Effect.flip(
        browserProfileCiphertextPath({ stateDir, profileId: ProfileAlpha, generation: -1 }),
      );

      assert.instanceOf(traversal, BrowserProfileFileError);
      assert.instanceOf(negative, BrowserProfileFileError);
      assert.strictEqual(traversal.operation, "decode id");
      assert.strictEqual(negative.operation, "derive path");
    }),
  );

  it.effect("a write is atomic, 0600 in a 0700 directory, and leaves no temporary", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "isnadi-profiles-" });
      const directory = `${stateDir}/${BROWSER_PROFILES_DIRECTORY}`;

      const target = yield* writeBrowserProfileCiphertext({
        stateDir,
        profileId: ProfileAlpha,
        generation: 0,
        ciphertext,
      });

      assert.strictEqual(yield* fileMode(directory), 0o700);
      assert.strictEqual(yield* fileMode(target), 0o600);
      assert.deepStrictEqual(yield* fs.readFile(target), ciphertext);
      assert.deepStrictEqual(yield* listNames(directory), [`${ProfileAlpha}.0.enc`]);
    }),
  );

  it.effect("a second generation replaces the first and the old file is the row's to keep", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "isnadi-profiles-" });
      const directory = `${stateDir}/${BROWSER_PROFILES_DIRECTORY}`;

      yield* writeBrowserProfileCiphertext({
        stateDir,
        profileId: ProfileAlpha,
        generation: 0,
        ciphertext,
      });
      yield* writeBrowserProfileCiphertext({
        stateDir,
        profileId: ProfileAlpha,
        generation: 1,
        ciphertext: new Uint8Array([9]),
      });

      assert.deepStrictEqual(yield* listNames(directory), [
        `${ProfileAlpha}.0.enc`,
        `${ProfileAlpha}.1.enc`,
      ]);

      const removed = yield* reconcileBrowserProfileCiphertext({
        stateDir,
        live: [{ profileId: ProfileAlpha, generation: 1 }],
      });

      assert.deepStrictEqual(removed, [`${directory}/${ProfileAlpha}.0.enc`]);
      assert.deepStrictEqual(yield* listNames(directory), [`${ProfileAlpha}.1.enc`]);
    }),
  );

  it.effect("a crash between the row delete and the file delete is cleaned up on boot", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "isnadi-profiles-" });
      const directory = `${stateDir}/${BROWSER_PROFILES_DIRECTORY}`;

      yield* writeBrowserProfileCiphertext({
        stateDir,
        profileId: ProfileAlpha,
        generation: 0,
        ciphertext,
      });
      yield* writeBrowserProfileCiphertext({
        stateDir,
        profileId: ProfileBeta,
        generation: 0,
        ciphertext,
      });
      // A half-written temporary and a file that was never ciphertext both go.
      yield* fs.writeFile(`${directory}/leftover.enc.tmp`, new Uint8Array([0]));
      yield* fs.writeFile(`${directory}/notes.txt`, new Uint8Array([0]));

      const removed = yield* reconcileBrowserProfileCiphertext({
        stateDir,
        live: [{ profileId: ProfileAlpha, generation: 0 }],
      });

      assert.deepStrictEqual(removed.toSorted(), [
        `${directory}/${ProfileBeta}.0.enc`,
        `${directory}/leftover.enc.tmp`,
      ]);
      assert.deepStrictEqual(yield* listNames(directory), [`${ProfileAlpha}.0.enc`, "notes.txt"]);
    }),
  );

  it.effect("nothing to reconcile is not an error", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "isnadi-profiles-" });

      assert.deepStrictEqual(yield* reconcileBrowserProfileCiphertext({ stateDir, live: [] }), []);
    }),
  );

  it.effect("a file name is read back only when it is one", () => {
    return Effect.sync(() => {
      assert.deepStrictEqual(
        parseBrowserProfileCiphertextFileName(`${ProfileAlpha}.2.enc`),
        Option.some({ profileId: ProfileAlpha, generation: 2 }),
      );
      assert.isTrue(Option.isNone(parseBrowserProfileCiphertextFileName(`${ProfileAlpha}.2`)));
      assert.isTrue(
        Option.isNone(parseBrowserProfileCiphertextFileName(`${ProfileAlpha}.2.enc.tmp`)),
      );
      assert.isTrue(Option.isNone(parseBrowserProfileCiphertextFileName("../passwd.0.enc")));
      assert.isTrue(Option.isNone(parseBrowserProfileCiphertextFileName(`${ProfileAlpha}.-1.enc`)));
      assert.isTrue(
        Option.isNone(parseBrowserProfileCiphertextFileName(`${ProfileAlpha}.1.2.enc`)),
      );
    });
  });
});
