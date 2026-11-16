import {
  FLEET_DISPATCH_CLAIM_ACTIVITY,
  FLEET_DISPATCH_IDLE_ACTIVITY,
  FLEET_DISPATCH_TRIAGE_ACTIVITY,
  FleetDispatchClaimPayload,
  FleetDispatchTriagePayload,
  type OrchestrationThreadActivity,
} from "@isnadi/contracts";
import { Schema } from "effect";
import { createTranslator } from "@isnadi/client-runtime/i18n";

import type { RoutineReceipt } from "./routineReceipts";

const isClaimPayload = Schema.is(FleetDispatchClaimPayload);

const isTriagePayload = Schema.is(FleetDispatchTriagePayload);

type ReceiptTranslator = Pick<ReturnType<typeof createTranslator>, "t">;

const englishTranslator: ReceiptTranslator = createTranslator("en");

/**
 * What the board did while nobody was typing, as rows in the group's chat.
 *
 * The server appends these as thread activities; the sentence around the data
 * is written here so the row reads in the user's language and the bot's name
 * and the item's title stay exactly as written, the way a routine receipt
 * translates its sentence and keeps the routine's name verbatim. A payload this
 * client cannot read falls back to the server's own summary rather than
 * dropping the row.
 */
export function deriveFleetReceipts(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  { t }: ReceiptTranslator = englishTranslator,
): RoutineReceipt[] {
  const receipts: RoutineReceipt[] = [];

  for (const activity of activities) {
    if (activity.kind === FLEET_DISPATCH_CLAIM_ACTIVITY) {
      receipts.push({
        id: activity.id,
        createdAt: activity.createdAt,
        text: isClaimPayload(activity.payload)
          ? t("{bot} was idle, so the board gave it “{item}”.", {
              bot: activity.payload.botName,
              item: activity.payload.itemTitle,
            })
          : activity.summary,
        tone: "info",
      });

      continue;
    }

    if (activity.kind === FLEET_DISPATCH_IDLE_ACTIVITY) {
      receipts.push({
        id: activity.id,
        createdAt: activity.createdAt,
        text: t("Everyone is idle and the board is empty."),
        tone: "info",
      });

      continue;
    }

    if (activity.kind === FLEET_DISPATCH_TRIAGE_ACTIVITY) {
      receipts.push({
        id: activity.id,
        createdAt: activity.createdAt,
        text: isTriagePayload(activity.payload)
          ? t("“{item}” goes to the {role} role, and no one here holds it.", {
              item: activity.payload.itemTitle,
              role: activity.payload.role,
            })
          : activity.summary,
        tone: "info",
      });
    }
  }

  return receipts;
}
