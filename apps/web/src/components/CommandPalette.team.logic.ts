import type { ReactNode } from "react";

import type { CommandPaletteActionItem, CommandPaletteGroup } from "./CommandPalette.logic";

/** Translate interface copy; the palette only ever renders authored strings. */
type Translate = (message: string, params?: Readonly<Record<string, string>>) => string;

/**
 * One member of the space, reduced to what a team row has to say and do. The
 * environment and thread are the bot's own chat, because Steer and Interrupt act
 * on that chat and not on the space.
 */
export interface TeamCommandBot {
  readonly id: string;
  readonly name: string;
  readonly environmentId: string;
  readonly threadId: string;
  /** A turn is running, which is the only state Interrupt can end. */
  readonly isRunning: boolean;
}

export interface TeamCommandPaletteInput {
  readonly spaceName: string;
  readonly bots: ReadonlyArray<TeamCommandBot>;
  readonly t: Translate;
  readonly icons: {
    readonly steer: ReactNode;
    readonly interrupt: ReactNode;
    readonly addBot: ReactNode;
  };
  readonly onSteer: (bot: TeamCommandBot) => Promise<void> | void;
  readonly onInterrupt: (bot: TeamCommandBot) => Promise<void> | void;
  readonly onAddBot: () => Promise<void> | void;
}

/**
 * The space's team rows, under one `Team · <space>` heading the way the frame
 * groups them. A bot appears twice at most — once to correct the turn it is
 * running and once to end it — and only while a turn is running, so the group
 * never lists a row that would do nothing. Adding a bot is always offered,
 * because a space can always take another member.
 *
 * Returns null when there is no space to scope the rows to.
 */
export function buildTeamCommandPaletteGroup(
  input: TeamCommandPaletteInput,
): CommandPaletteGroup | null {
  const spaceName = input.spaceName.trim();

  if (spaceName === "") return null;

  const running = input.bots.filter((bot) => bot.isRunning);

  const steerItems: CommandPaletteActionItem[] = running.map((bot) => {
    const title = input.t("Steer {name}…", { name: bot.name });

    return {
      value: `team:steer:${bot.id}`,
      searchTerms: [title, input.t("Steer"), "steer", "correct", "redirect", bot.name],
      title,
      description: input.t("Opens the chat and puts the caret in the composer"),
      icon: input.icons.steer,
      run: async () => {
        await input.onSteer(bot);
      },
    };
  });

  const interruptItems: CommandPaletteActionItem[] = running.map((bot) => {
    const title = input.t("Interrupt {name} now", { name: bot.name });

    return {
      value: `team:interrupt:${bot.id}`,
      searchTerms: [title, input.t("Interrupt"), "interrupt", "stop", "cancel", bot.name],
      title,
      description: input.t("Ends the turn this bot is running"),
      icon: input.icons.interrupt,
      run: async () => {
        await input.onInterrupt(bot);
      },
    };
  });

  const addBotTitle = input.t("Add a bot to {name}…", { name: spaceName });

  const addBotItem: CommandPaletteActionItem = {
    value: "team:add-bot",
    searchTerms: [addBotTitle, input.t("Add bot"), "add", "bot", "member", spaceName],
    title: addBotTitle,
    description: input.t("Opens the role library to add a bot"),
    icon: input.icons.addBot,
    run: async () => {
      await input.onAddBot();
    },
  };

  return {
    value: "team",
    label: input.t("Team · {name}", { name: spaceName }),
    items: [...steerItems, ...interruptItems, addBotItem],
  };
}
