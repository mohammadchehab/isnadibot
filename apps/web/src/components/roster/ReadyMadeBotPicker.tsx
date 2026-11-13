import { READY_MADE_BOTS, type ReadyMadeBotId } from "@isnadi/contracts";
import { routineScheduleLabel } from "@isnadi/client-runtime/routines";
import {
  readyMadeBotCopy,
  readyMadeStartSchedule,
} from "@isnadi/client-runtime/fleet/ready-made-bot";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";

/**
 * The roster's starting points. A preset fills in the bot's schedule and what it
 * does, so adding the link monitor is one row and one Create; from scratch leaves
 * every choice to the user.
 */
export function ReadyMadeBotPicker({
  selected,
  timezone,
  onSelect,
}: {
  readonly selected: ReadyMadeBotId | null;
  readonly timezone: string;
  readonly onSelect: (id: ReadyMadeBotId | null) => void;
}) {
  const { t, formatDate } = useI18n();

  return (
    <section aria-labelledby="ready-made-bots-heading" className="space-y-2">
      <h3 id="ready-made-bots-heading" className="text-sm font-medium text-foreground">
        {t("Start with")}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant={selected === null ? "ghost-current" : "ghost-quiet"}
          size="row-relaxed"
          aria-pressed={selected === null}
          data-testid="new-bot-start-from-scratch"
          className="h-auto items-start text-start"
          onClick={() => onSelect(null)}
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">{t("From scratch")}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("Name a bot and pick its look yourself.")}
            </span>
          </span>
        </Button>
        {READY_MADE_BOTS.map((bot) => {
          const copy = readyMadeBotCopy(bot.id);

          // A preset without copy has nothing to say on its row, so it stays out of the list.
          if (!copy) return null;
          const schedule = readyMadeStartSchedule(bot, timezone);

          return (
            <Button
              key={bot.id}
              type="button"
              variant={selected === bot.id ? "ghost-current" : "ghost-quiet"}
              size="row-relaxed"
              aria-pressed={selected === bot.id}
              data-testid={`new-bot-preset-${bot.id}`}
              className="h-auto items-start text-start"
              onClick={() => onSelect(bot.id)}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{t(copy.name)}</span>
                <span className="text-xs font-normal text-muted-foreground">{t(copy.role)}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {routineScheduleLabel(schedule, { t, formatDate })}
                </span>
              </span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
