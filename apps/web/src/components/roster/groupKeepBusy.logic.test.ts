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

    expect(copy.label).toBe("t:Keep this group busy");
    expect(copy.failureTitle).toBe("t:Could not change keep-busy for this group");
    expect(copy.hint.startsWith("t:")).toBe(true);
  });

  // Turning the switch off reads a turn still running finish, so the hint has to
  // say both halves: what on buys, and what off leaves running.
  it("says that off stops new items but finishes work in progress", () => {
    const copy = groupKeepBusyCopy(markingTranslate);

    expect(copy.hint).toContain("new items");
    expect(copy.hint).toContain("in progress");
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
