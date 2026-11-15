/**
 * The text a thrown cause carries, for a surface that shows the app's own sentence and keeps the
 * raw cause behind a disclosure. Returns `null` when the cause says nothing a user could read.
 */
export function rawCauseMessage(cause: unknown): string | null {
  const message = cause instanceof Error ? cause.message : String(cause);

  return message.trim().length === 0 ? null : message;
}
