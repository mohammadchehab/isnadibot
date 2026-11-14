import type { BotStatus } from "@isnadi/shared/botStatus";
import type { MessageKey } from "@isnadi/client-runtime/i18n";

/** What a bot is doing, in the one word every roster surface shows for it. */
export const BOT_STATUS_LABEL: Readonly<Record<BotStatus, MessageKey>> = {
  asking: "Asking",
  "sign-in-required": "Sign in",
  held: "Held",
  busy: "Busy",
  idle: "Idle",
};

/**
 * The only colour a state gets: asking is what the user must act on, sign-in
 * is what they have to go and fix, held is what they have to unblock, and the
 * rest stay quiet.
 */
export const BOT_STATUS_TONE: Readonly<Record<BotStatus, string>> = {
  asking: "text-warning-foreground",
  "sign-in-required": "text-info-foreground",
  held: "text-caution-foreground",
  busy: "text-foreground",
  idle: "text-muted-foreground",
};
