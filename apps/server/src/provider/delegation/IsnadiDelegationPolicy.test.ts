import type { BotSandbox } from "@isnadi/contracts";
import { describe, expect, it } from "vite-plus/test";
import { childAccess } from "./IsnadiDelegationPolicy.ts";
import { bot, CHILD_BOT_ID } from "../testUtils/delegationHarness.ts";

const noMcpServers: ReadonlyArray<never> = [];

const accessFor = (sandbox: BotSandbox | null, defaultProvider: BotSandbox) =>
  childAccess(bot(CHILD_BOT_ID, { sandbox }), noMcpServers, undefined, defaultProvider);

describe("childAccess sandbox resolution", () => {
  it("gives a bot with no sandbox of its own the same access as one set to Local", () => {
    // Equality, not two literals: the two paths cannot drift apart again.
    expect(accessFor(null, "local")).toEqual(accessFor("local", "local"));
  });

  it("derives user-computer access from the resolved sandbox, not the stored one", () => {
    expect(accessFor(null, "local").hasUserComputer).toBe(true);
    expect(accessFor("local", "local").hasUserComputer).toBe(true);
    expect(accessFor("e2b", "local").hasUserComputer).toBe(false);
  });

  it("keeps a bot's own sandbox through delegation", () => {
    expect(accessFor("e2b", "local").sandbox).toBe("e2b");
  });

  it("follows the environment default rather than assuming Local", () => {
    expect(accessFor(null, "daytona").sandbox).toBe("daytona");
    expect(accessFor(null, "daytona").hasUserComputer).toBe(false);
  });
});
