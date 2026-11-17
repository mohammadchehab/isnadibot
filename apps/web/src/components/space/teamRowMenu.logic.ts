import type { ReactNode } from "react";

/** Translate interface copy; the menu only ever renders authored strings. */
type Translate = (message: string, params?: Readonly<Record<string, string>>) => string;

/**
 * One team row, reduced to what its menu has to decide. Both flags come from the
 * row's own chat through `resolveBotControlAvailability`, so the menu offers what
 * the engine can act on rather than what the row's status word implies: a row
 * reads Busy while its turn is still starting, and a correction sent into a group
 * chat is not offered at all.
 */
export interface TeamRowMenuBot {
  readonly name: string;
  readonly isBoss: boolean;
  readonly canSteer: boolean;
  readonly canInterrupt: boolean;
}

export interface TeamRowMenuInput {
  readonly bot: TeamRowMenuBot;
  readonly t: Translate;
  readonly icons: {
    readonly steer: ReactNode;
    readonly interrupt: ReactNode;
    readonly archive: ReactNode;
  };
  readonly onSteer: () => void;
  readonly onInterrupt: () => void;
  readonly onArchive: () => void;
}

export type TeamRowMenuId = "steer" | "interrupt" | "archive";

/** One entry, ready to draw: the label is already translated for this bot. */
export interface TeamRowMenuItem {
  readonly id: TeamRowMenuId;
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant: "default" | "destructive";
  readonly run: () => void;
}

/**
 * The entries one row's menu offers, in the frame's order (E13b `2546:3758`).
 *
 * An entry is absent rather than disabled when the row cannot use it: the menu
 * item has no disabled look the frame draws, and decision-117 kept this menu to
 * the entries that do something when clicked.
 *
 * Archive is the only destructive entry, and it is absent on the boss: archiving
 * it would leave the space with no dispatcher, and `group.boss.set` is the way
 * to change bosses.
 */
export function buildTeamRowMenu(input: TeamRowMenuInput): ReadonlyArray<TeamRowMenuItem> {
  const { bot } = input;
  const items: TeamRowMenuItem[] = [];

  if (bot.canSteer) {
    items.push({
      id: "steer",
      label: input.t("Steer {name}…", { name: bot.name }),
      icon: input.icons.steer,
      variant: "default",
      run: input.onSteer,
    });
  }

  if (bot.canInterrupt) {
    items.push({
      id: "interrupt",
      label: input.t("Interrupt now"),
      icon: input.icons.interrupt,
      variant: "default",
      run: input.onInterrupt,
    });
  }

  if (!bot.isBoss) {
    items.push({
      id: "archive",
      label: input.t("Archive {name}…", { name: bot.name }),
      icon: input.icons.archive,
      variant: "destructive",
      run: input.onArchive,
    });
  }

  return items;
}
