import { describe, expect, it, vi } from "vite-plus/test";

import { buildTeamCommandPaletteGroup, type TeamCommandBot } from "./CommandPalette.team.logic";

const t = (message: string, params?: Readonly<Record<string, string>>) =>
  message.replace(/\{(\w+)\}/g, (whole, name: string) => params?.[name] ?? whole);

const tailor: TeamCommandBot = {
  id: "bot-tailor",
  name: "Tailor",
  environmentId: "env-1",
  threadId: "thread-1",
  isRunning: true,
};

const build = (bots: ReadonlyArray<TeamCommandBot>, spaceName = "Recruiting") =>
  buildTeamCommandPaletteGroup({
    spaceName,
    bots,
    t,
    icons: { steer: null, interrupt: null, addBot: null },
    onSteer: () => {},
    onInterrupt: () => {},
    onAddBot: () => {},
  });

describe("the team group in the command palette", () => {
  it("heads the rows with the space, and has no group without one", () => {
    expect(build([tailor])?.label).toBe("Team · Recruiting");
    expect(build([tailor])?.value).toBe("team");
    expect(build([tailor], "   ")).toBeNull();
  });

  it("offers a steer and an interrupt row per running bot, then adding a bot", () => {
    const group = build([tailor, { ...tailor, id: "bot-scout", name: "Scout" }]);

    expect(group?.items.map((item) => item.value)).toEqual([
      "team:steer:bot-tailor",
      "team:steer:bot-scout",
      "team:interrupt:bot-tailor",
      "team:interrupt:bot-scout",
      "team:add-bot",
    ]);
    expect(group?.items.map((item) => item.title)).toEqual([
      "Steer Tailor…",
      "Steer Scout…",
      "Interrupt Tailor now",
      "Interrupt Scout now",
      "Add a bot to Recruiting…",
    ]);
  });

  it("leaves a bot that is not running with nothing to steer or interrupt", () => {
    expect(build([{ ...tailor, isRunning: false }])?.items.map((item) => item.value)).toEqual([
      "team:add-bot",
    ]);
  });

  it("runs the command against the bot the row names", async () => {
    const onSteer = vi.fn();
    const onInterrupt = vi.fn();

    const group = buildTeamCommandPaletteGroup({
      spaceName: "Recruiting",
      bots: [tailor],
      t,
      icons: { steer: null, interrupt: null, addBot: null },
      onSteer,
      onInterrupt,
      onAddBot: () => {},
    });

    await group?.items[0]?.run();
    await group?.items[1]?.run();

    expect(onSteer).toHaveBeenCalledWith(tailor);
    expect(onInterrupt).toHaveBeenCalledWith(tailor);
  });

  it("finds a row by the bot's name, the command and what it does", () => {
    const [steer, interrupt, addBot] = build([tailor])?.items ?? [];

    expect(steer?.searchTerms).toEqual(
      expect.arrayContaining(["Steer Tailor…", "steer", "Tailor"]),
    );
    expect(interrupt?.searchTerms).toEqual(
      expect.arrayContaining(["Interrupt Tailor now", "interrupt", "Tailor"]),
    );
    expect(addBot?.searchTerms).toEqual(
      expect.arrayContaining(["Add a bot to Recruiting…", "add", "Recruiting"]),
    );
  });

  it("says what each row does", () => {
    expect(build([tailor])?.items.map((item) => item.description)).toEqual([
      "Opens the chat and puts the caret in the composer",
      "Ends the turn this bot is running",
      "Opens the role library to add a bot",
    ]);
  });
});
