import { describe, expect, it } from "vite-plus/test";

import { spaceSettingsState, type SpaceSettingsTranslator } from "./spaceSettings.logic";

/**
 * The web page reads the shared rules through this module (decision-106). The
 * rules themselves are tested where they live, in
 * `packages/client-runtime/src/space/settings.test.ts`; this file proves the
 * path the web components import still answers the way it did before the move.
 */
const translator: SpaceSettingsTranslator = {
  t: (message, params) =>
    Object.entries(params ?? {}).reduce(
      (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
      message,
    ),
  plural: (count, forms) =>
    (count === 1 ? (forms.one ?? forms.other) : forms.other).replaceAll("{count}", String(count)),
};

describe("the web binding to the shared space-settings rules", () => {
  it("still says an empty space has no boss to pick", () => {
    const settings = spaceSettingsState({ members: [], bossBotId: null }, translator);

    expect(settings.statusLine).toBe("No bots yet");
    expect(settings.bossDisabled).toBe(true);
    expect(settings.keepBusyDisabled).toBe(true);
  });

  it("still names the boss and leaves both rows live when the space can hand work out", () => {
    const settings = spaceSettingsState(
      {
        members: [
          { id: "bot-tracker", name: "Tracker" },
          { id: "bot-scout", name: "Scout" },
        ],
        bossBotId: "bot-tracker",
      },
      translator,
    );

    expect(settings.statusLine).toBe("2 bots · Tracker is the boss");
    expect(settings.bossDisabled).toBe(false);
    expect(settings.bossHint).toBeNull();
    expect(settings.keepBusyDisabled).toBe(false);
    expect(settings.keepBusyHint).toBeNull();
  });
});
