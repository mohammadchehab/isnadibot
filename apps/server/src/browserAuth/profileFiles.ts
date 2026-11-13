import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { BrowserProfileId } from "./profileId.ts";

/** Where every profile's ciphertext lives, relative to the environment's state directory. */
export const BROWSER_PROFILES_DIRECTORY = "browser-profiles";

const DIRECTORY_MODE = 0o700;

const FILE_MODE = 0o600;

const CIPHERTEXT_SUFFIX = ".enc";

const TEMPORARY_SUFFIX = ".tmp";

export class BrowserProfileFileError extends Schema.TaggedErrorClass<BrowserProfileFileError>()(
  "BrowserProfileFileError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Browser profile file ${this.operation} failed: ${this.detail}`;
  }
}

const fileError =
  (operation: string) =>
  (cause: { readonly message: string }): BrowserProfileFileError =>
    new BrowserProfileFileError({ operation, detail: cause.message, cause });

export interface BrowserProfileGeneration {
  readonly profileId: BrowserProfileId;
  readonly generation: number;
}

const decodeBrowserProfileId = Schema.decodeUnknownEffect(BrowserProfileId);

const decodeBrowserProfileIdOption = Schema.decodeUnknownOption(BrowserProfileId);

const decodeProfileId = (value: string) =>
  decodeBrowserProfileId(value).pipe(
    Effect.mapError(
      (cause) =>
        new BrowserProfileFileError({
          operation: "decode id",
          detail: "a browser profile id must be a server-minted uuid",
          cause,
        }),
    ),
  );

/**
 * The one place a ciphertext path is built. Both parts come from the row, never from a request:
 * the id is decoded through the brand first, and the generation is a non-negative integer, so a
 * caller cannot name a file outside the directory.
 */
export const browserProfileCiphertextPath = (input: {
  readonly stateDir: string;
  /** Decoded here, so a value that did not come through the brand is refused, not joined. */
  readonly profileId: string;
  readonly generation: number;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const profileId = yield* decodeProfileId(input.profileId);

    if (!Number.isInteger(input.generation) || input.generation < 0) {
      return yield* new BrowserProfileFileError({
        operation: "derive path",
        detail: "a profile generation must be a non-negative integer",
      });
    }

    return path.join(
      input.stateDir,
      BROWSER_PROFILES_DIRECTORY,
      `${profileId}.${input.generation}${CIPHERTEXT_SUFFIX}`,
    );
  });

/** Read a file name back into the row it belongs to; anything else is not profile ciphertext. */
export const parseBrowserProfileCiphertextFileName = (fileName: string) => {
  if (!fileName.endsWith(CIPHERTEXT_SUFFIX)) {
    return Option.none<BrowserProfileGeneration>();
  }

  const [profileId, generation, ...rest] = fileName.slice(0, -CIPHERTEXT_SUFFIX.length).split(".");

  if (profileId === undefined || generation === undefined || rest.length > 0) {
    return Option.none<BrowserProfileGeneration>();
  }

  const decoded = decodeBrowserProfileIdOption(profileId);
  const generationNumber = Number(generation);

  if (Option.isNone(decoded) || !Number.isInteger(generationNumber) || generationNumber < 0) {
    return Option.none<BrowserProfileGeneration>();
  }

  return Option.some({
    profileId: decoded.value,
    generation: generationNumber,
  } satisfies BrowserProfileGeneration);
};

/**
 * Write one generation's ciphertext. The directory is 0700 and the file 0600, and the write is
 * atomic: bytes go to a temporary file, are flushed to the device, and the temporary is renamed
 * over the target. A crash leaves either the previous generation or the new one, never half of
 * one.
 */
export const writeBrowserProfileCiphertext = (input: {
  readonly stateDir: string;
  readonly profileId: string;
  readonly generation: number;
  readonly ciphertext: Uint8Array;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.join(input.stateDir, BROWSER_PROFILES_DIRECTORY);
    const target = yield* browserProfileCiphertextPath(input);
    const temporary = `${target}${TEMPORARY_SUFFIX}`;

    yield* fs.makeDirectory(directory, { recursive: true, mode: DIRECTORY_MODE });
    yield* fs.chmod(directory, DIRECTORY_MODE);

    yield* Effect.scoped(
      Effect.gen(function* () {
        const file = yield* fs.open(temporary, { flag: "w", mode: FILE_MODE });
        yield* file.writeAll(input.ciphertext);
        yield* file.sync;
      }),
    );

    // `open`'s mode is filtered through the process umask; the guarantee is what we chmod to.
    yield* fs.chmod(temporary, FILE_MODE);
    yield* fs.rename(temporary, target);

    return target;
  }).pipe(Effect.mapError(fileError("write")));

/**
 * Startup reconcile. The profile row is the only index the directory has, so a file is kept only
 * while its row exists at that generation. A file left behind by a crash between the row delete
 * and the file delete, a save that lost its generation, and a half-written temporary are all
 * removed here. Runs on every boot, and does nothing when the directory is absent.
 */
export const reconcileBrowserProfileCiphertext = (input: {
  readonly stateDir: string;
  readonly live: ReadonlyArray<BrowserProfileGeneration>;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = path.join(input.stateDir, BROWSER_PROFILES_DIRECTORY);

    if (!(yield* fs.exists(directory))) {
      return [];
    }

    const keep = new Set(input.live.map((row) => `${row.profileId}.${row.generation}`));
    const names = yield* fs.readDirectory(directory);
    const removed: Array<string> = [];

    for (const name of names) {
      const file = path.join(directory, name);
      const parsed = parseBrowserProfileCiphertextFileName(name);

      if (
        Option.isSome(parsed) &&
        keep.has(`${parsed.value.profileId}.${parsed.value.generation}`)
      ) {
        continue;
      }

      if (Option.isNone(parsed) && !name.endsWith(TEMPORARY_SUFFIX)) {
        continue;
      }

      yield* fs.remove(file, { force: true });
      removed.push(file);
    }

    return removed;
  }).pipe(Effect.mapError(fileError("reconcile")));
