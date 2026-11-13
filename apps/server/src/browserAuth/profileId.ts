import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * A browser profile id is minted by the server, never derived from a site or from owner input.
 * Its charset is the whole path-traversal defence: the ciphertext file is named
 * `<profileId>.<generation>.enc` under `<stateDir>/browser-profiles`, so anything but hex digits
 * and dashes could name a file outside that directory.
 */
export const BrowserProfileId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("BrowserProfileId"),
);

export type BrowserProfileId = typeof BrowserProfileId.Type;

/** A fresh id, minted from the crypto service so a test can pin the source. */
export const mintBrowserProfileId = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;

  return BrowserProfileId.make(crypto.randomUUIDv4());
});
