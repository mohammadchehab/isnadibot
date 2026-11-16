/**
 * Attaches the underlying failure to an error as a native `Error` cause.
 *
 * A `Schema.Defect()` on an error class would put the failure's name, message and cause chain on
 * the wire, where every client receives it. The error classes carry structured fields instead
 * (`reason`, `detail`, `operation`), and the failure itself stays here: `Error.cause` is a plain
 * property that no schema encodes, so a log reads it and the wire never does.
 */
export function withCause<E extends globalThis.Error>(error: E, cause: unknown): E {
  if (cause !== undefined) error.cause = cause;

  return error;
}
