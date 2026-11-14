import { describe, expect, it } from "vite-plus/test";

import { groupKeepBusyCopy, groupKeepsBusy } from "./groupKeepBusy.logic";

/**
 * A translator that marks every key it sees, so a caller that forgets to pass
 * the UI's `t` shows up as English and fails the test rather than shipping.
 */
const markingTranslate = (message: string) => `t:${message}`;

describe("groupKeepBusyCopy", () => {
  it("routes every word it shows through the translator", () => {
    const copy = groupKeepBusyCopy(markingTranslate);

    expect(copy.label).toBe("t:Keep everyone busy");
    expect(copy.failureTitle).toBe("t:Could not change keep-busy for this group");
    expect(copy.hint.startsWith("t:")).toBe(true);
    expect(copy.offHint.startsWith("t:")).toBe(true);
  });

  // The designer signed off these two sentences word for word, so a rewrite here
  // is a design change, not a copy tweak.
  it("shows the approved sentences verbatim", () => {
    const copy = groupKeepBusyCopy(markingTranslate);

    expect(copy.hint).toBe(
      "t:When a bot goes idle, it gets the next card. The boss is woken only to judge.",
    );
    expect(copy.offHint).toBe(
      "t:Turn it off and bots stop taking new cards; cards already running finish.",
    );
  });
});

describe("groupKeepsBusy", () => {
  it("reads a group the server never wrote the field for as off", () => {
    expect(groupKeepsBusy({})).toBe(false);
    expect(groupKeepsBusy({ keepBusy: false })).toBe(false);
  });

  it("reads a group kept busy as on", () => {
    expect(groupKeepsBusy({ keepBusy: true })).toBe(true);
  });
});
