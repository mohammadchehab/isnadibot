import type { QueuedThreadMessage, ThreadOutboxFailureDecision } from "./thread-outbox-model";

/** The decided failures that keep the item; `retry` is handled before this runs. */
type TerminalFailure = Extract<
  ThreadOutboxFailureDecision,
  { readonly action: "block" | "discard" }
>;

/**
 * Records why a queued delivery stopped, on the item itself. Writing the reason
 * is what keeps the item in the outbox — the drain skips anything carrying one —
 * so the user still has the text and can read why it did not send.
 *
 * `update` is passed in rather than imported so the rule stays testable without
 * the hook, and the caller owns the write.
 */
export async function persistQueuedThreadFailure(input: {
  readonly message: QueuedThreadMessage;
  readonly failure: TerminalFailure;
  readonly now: string;
  readonly update: (message: QueuedThreadMessage) => Promise<boolean>;
}): Promise<void> {
  await input.update({
    ...input.message,
    failure: {
      refusal: input.failure.refusal,
      action: input.failure.action,
      at: input.now,
    },
  });
}
