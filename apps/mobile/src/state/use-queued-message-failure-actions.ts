import { useCallback } from "react";

import { removeThreadOutboxMessage, updateThreadOutboxMessage } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export interface QueuedMessageFailureActions {
  /** Clears the failure so the drain picks the item up again. */
  readonly retryQueuedMessage: (message: QueuedThreadMessage) => Promise<void>;
  /** Removes the item for good, text and all. */
  readonly discardQueuedMessage: (message: QueuedThreadMessage) => Promise<void>;
}

/**
 * The two things a user can do about a queued message that stopped. Try again
 * drops the recorded failure, which is the only thing keeping the drain off it,
 * so the message is re-armed exactly as it was written.
 */
export function useQueuedMessageFailureActions(): QueuedMessageFailureActions {
  const retryQueuedMessage = useCallback(async (message: QueuedThreadMessage) => {
    const { failure: _failure, ...rearmed } = message;

    await updateThreadOutboxMessage(rearmed);
  }, []);

  const discardQueuedMessage = useCallback(async (message: QueuedThreadMessage) => {
    await removeThreadOutboxMessage(message);
  }, []);

  return { retryQueuedMessage, discardQueuedMessage };
}
