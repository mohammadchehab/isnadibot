import { describe, expect, it } from "vite-plus/test";

import { buildTeamRowMenu, type TeamRowMenuInput } from "./teamRowMenu.logic";

const t = (message: string, values?: Record<string, string | number>) =>
  Object.entries(values ?? {}).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    message,
  );

const build = (overrides: Partial<TeamRowMenuInput["bot"]>) =>
  buildTeamRowMenu({
    bot: { name: "Tailor", isBoss: false, canSteer: false, canInterrupt: false, ...overrides },
    t,
    icons: { steer: null, interrupt: null, archive: null },
    onSteer: () => undefined,
    onInterrupt: () => undefined,
    onArchive: () => undefined,
  });

const ids = (overrides: Partial<TeamRowMenuInput["bot"]>) =>
  build(overrides).map((item) => item.id);

describe("team row menu", () => {
  it("offers steer, interrupt and archive on a busy row that is not the boss", () => {
    const items = build({ canSteer: true, canInterrupt: true });

    expect(items.map((item) => item.id)).toEqual(["steer", "interrupt", "archive"]);
    expect(items.map((item) => item.label)).toEqual([
      "Steer Tailor…",
      "Interrupt now",
      "Archive Tailor…",
    ]);
    // Archive is the only entry that takes the bot away, so it is the only destructive one.
    expect(items.filter((item) => item.variant === "destructive").map((item) => item.id)).toEqual([
      "archive",
    ]);
  });

  it("leaves archive off the boss row", () => {
    // Archiving the boss would leave the space with no dispatcher.
    expect(ids({ isBoss: true, canSteer: true, canInterrupt: true })).toEqual([
      "steer",
      "interrupt",
    ]);
  });

  it("leaves steer and interrupt off a row whose chat has no turn to act on", () => {
    expect(ids({})).toEqual(["archive"]);
  });

  it("runs the entry's own action, so one row cannot reach another row's bot", () => {
    const clicked: string[] = [];

    const items = buildTeamRowMenu({
      bot: { name: "Tailor", isBoss: false, canSteer: true, canInterrupt: true },
      t,
      icons: { steer: null, interrupt: null, archive: null },
      onSteer: () => clicked.push("steer"),
      onInterrupt: () => clicked.push("interrupt"),
      onArchive: () => clicked.push("archive"),
    });

    for (const item of items) item.run();

    expect(clicked).toEqual(["steer", "interrupt", "archive"]);
  });
});
