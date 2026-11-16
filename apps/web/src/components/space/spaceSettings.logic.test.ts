import { describe, expect, it } from "vite-plus/test";

import { spaceSettingsState, type SpaceSettingsTranslator } from "./spaceSettings.logic";

/**
 * A translator that marks every key it sees, so a caller that forgets to pass
 * the UI's `t` shows up as English and fails the test rather than shipping.
 */
const markingTranslate = (message: string, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    `t:${message}`,
  );

/** `plural` resolves its own form and injects `{count}`, so only the count shows here. */
const markingPlural: SpaceSettingsTranslator["plural"] = (count, forms) =>
  (count === 1 ? (forms.one ?? forms.other) : forms.other).replaceAll("{count}", String(count));

const translator: SpaceSettingsTranslator = { t: markingTranslate, plural: markingPlural };

const state = (members: ReadonlyArray<{ id: string; name: string }>, bossBotId: string | null) =>
  spaceSettingsState({ members, bossBotId }, translator);

const layla = { id: "bot-layla", name: "Layla" };

const tracker = { id: "bot-tracker", name: "Tracker" };

const scout = { id: "bot-scout", name: "Scout" };

const patch = { id: "bot-patch", name: "Patch" };

describe("spaceSettingsState — empty space", () => {
  it("says so in one line and offers no boss to pick", () => {
    const settings = state([], null);

    expect(settings.memberCount).toBe(0);
    expect(settings.bossName).toBeNull();
    expect(settings.statusLine).toBe("t:No bots yet");
    expect(settings.bossDisabled).toBe(true);
    expect(settings.bossPlaceholder).toBe("t:No bots yet");
    expect(settings.bossHint).toBe("t:Add a bot to this space first.");
  });

  it("keeps keep-busy off, because there is nobody to hand work to", () => {
    const settings = state([], null);

    expect(settings.keepBusyDisabled).toBe(true);
    expect(settings.keepBusyHint).toBe("t:Needs two bots — one to work, one to hand off to.");
  });
});

describe("spaceSettingsState — one bot", () => {
  it("names the only bot as the boss and still keeps keep-busy off", () => {
    const settings = state([layla], layla.id);

    expect(settings.statusLine).toBe("t:1 bot · Layla is the boss");
    expect(settings.bossDisabled).toBe(false);
    expect(settings.bossName).toBe("Layla");
    expect(settings.bossHint).toBe("t:The only bot in this space.");
    expect(settings.keepBusyDisabled).toBe(true);
    expect(settings.keepBusyHint).toBe("t:Needs two bots — one to work, one to hand off to.");
  });

  it("asks for a boss when the one bot was never given the role", () => {
    const settings = state([layla], null);

    expect(settings.statusLine).toBe("t:1 bot · No boss yet");
    expect(settings.bossPlaceholder).toBe("t:Choose a boss");
    expect(settings.bossHint).toBe("t:The only bot in this space.");
  });
});

describe("spaceSettingsState — a space that can hand work out", () => {
  it("names the boss in the status line and leaves both rows without a hint", () => {
    const settings = state([tracker, scout, patch, layla], tracker.id);

    expect(settings.statusLine).toBe("t:4 bots · Tracker is the boss");
    expect(settings.bossName).toBe("Tracker");
    expect(settings.bossHint).toBeNull();
    expect(settings.keepBusyDisabled).toBe(false);
    expect(settings.keepBusyHint).toBeNull();
  });

  it("counts in the plural for every member", () => {
    expect(state([tracker, scout], tracker.id).statusLine).toBe("t:2 bots · Tracker is the boss");
  });
});

describe("spaceSettingsState — bots but no boss", () => {
  it("says why keep-busy cannot move, and that cards wait", () => {
    const settings = state([tracker, scout, patch], null);

    expect(settings.statusLine).toBe("t:3 bots · No boss yet");
    expect(settings.bossPlaceholder).toBe("t:Choose a boss");
    expect(settings.bossHint).toBe("t:Cards wait in the queue until a boss is chosen.");
    expect(settings.keepBusyDisabled).toBe(true);
    expect(settings.keepBusyHint).toBe("t:Cards wait in the queue until a boss is chosen.");
  });

  it("treats a boss who left the space as no boss, not as a nameless one", () => {
    const settings = state([scout, patch], layla.id);

    expect(settings.bossName).toBeNull();
    expect(settings.statusLine).toBe("t:2 bots · No boss yet");
    expect(settings.keepBusyDisabled).toBe(true);
  });
});
