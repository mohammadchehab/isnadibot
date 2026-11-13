import { useSyncExternalStore } from "react";

/**
 * A pending request to put the caret in one bot's composer. Steer runs from the
 * roster row menu and the command palette, which sit outside the composer, so
 * the request travels by bot id: whichever composer speaks for that bot claims
 * it — on mount when it is opened by the steer, or on the next frame when the
 * user was already looking at that chat.
 */
const pending = new Set<string>();

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Asks the composer that speaks for this bot to take the caret. */
export function requestComposerFocus(botId: string): void {
  if (pending.has(botId)) return;

  pending.add(botId);
  notify();
}

/** Takes the pending request for one bot, so the composer acts on it exactly once. */
export function claimComposerFocus(botId: string): boolean {
  if (!pending.delete(botId)) return false;

  notify();

  return true;
}

export function isComposerFocusPending(botId: string | undefined): boolean {
  return botId !== undefined && pending.has(botId);
}

/** Notifies on every request and claim; the composer's hook reads the pending set through it. */
export function subscribeComposerFocus(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Whether a steer is waiting for this bot's composer to take the caret. */
export function useComposerFocusRequest(botId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribeComposerFocus,
    () => isComposerFocusPending(botId),
    () => false,
  );
}
