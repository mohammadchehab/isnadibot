const MASK = "***";

/**
 * Masks the account handle a provider reports for the signed-in account, which
 * is usually an email address. Provider status crosses the wire to every client
 * that can read the environment, and it only has to say which account is signed
 * in, so the full handle never leaves the server: `m***@example.com`.
 *
 * Opaque account ids that drivers report instead of a handle (`account-123`)
 * pass through unchanged. They identify the account to the provider, not a
 * person, and masking them only makes the status harder to read.
 */
export function maskAccountHandle(value: string): string {
  const handle = value.trim();
  const at = handle.lastIndexOf("@");

  if (at < 0) return handle;

  return `${handle.slice(0, at).slice(0, 1)}${MASK}@${handle.slice(at + 1)}`;
}
