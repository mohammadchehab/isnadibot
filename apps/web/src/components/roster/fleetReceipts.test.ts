import {
  BotId,
  EventId,
  FLEET_DISPATCH_CLAIM_ACTIVITY,
  FLEET_DISPATCH_IDLE_ACTIVITY,
  FLEET_DISPATCH_TRIAGE_ACTIVITY,
  FleetRoleId,
  WorkItemId,
  type OrchestrationThreadActivity,
} from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveFleetReceipts } from "./fleetReceipts";

const activity = (
  kind: string,
  payload: OrchestrationThreadActivity["payload"],
  summary = "the server's own sentence",
): OrchestrationThreadActivity => ({
  id: EventId.make(`activity-${kind}`),
  tone: "info",
  kind,
  summary,
  payload,
  turnId: null,
  createdAt: "2026-11-16T09:00:00.000Z",
});

const ITEM_ID = WorkItemId.make("item-1");

describe("deriveFleetReceipts", () => {
  it("reads a hand-out into a row naming the bot and the item", () => {
    const [receipt] = deriveFleetReceipts([
      activity(FLEET_DISPATCH_CLAIM_ACTIVITY, {
        botId: BotId.make("bot-a"),
        botName: "Coach",
        workItemId: ITEM_ID,
        itemTitle: "Fix the login",
      }),
    ]);

    expect(receipt?.text).toBe("Coach was idle, so the board gave it “Fix the login”.");
  });

  it("reads an idle note into a row", () => {
    const [receipt] = deriveFleetReceipts([activity(FLEET_DISPATCH_IDLE_ACTIVITY, {})]);

    expect(receipt?.text).toBe("Everyone is idle and the board is empty.");
  });

  // The row is the only sign the item is waiting, so it names the role that unblocks it.
  it("reads a triage note into a row naming the role nobody holds", () => {
    const [receipt] = deriveFleetReceipts([
      activity(FLEET_DISPATCH_TRIAGE_ACTIVITY, {
        workItemId: ITEM_ID,
        itemTitle: "Fix the login",
        role: FleetRoleId.make("architect"),
      }),
    ]);

    expect(receipt?.text).toBe(
      "“Fix the login” goes to the architect role, and no one here holds it.",
    );
  });

  // A payload this client cannot read must not cost the row.
  it("falls back to the server's summary when the payload does not decode", () => {
    const [receipt] = deriveFleetReceipts([
      activity(FLEET_DISPATCH_TRIAGE_ACTIVITY, { somethingElse: true }),
    ]);

    expect(receipt?.text).toBe("the server's own sentence");
  });

  it("ignores an activity that is not a fleet note", () => {
    expect(deriveFleetReceipts([activity("thread.note", {})])).toEqual([]);
  });
});
