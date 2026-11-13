import {
  LINK_MONITOR_BOT_ID,
  LINK_MONITOR_LINK_BUDGET,
  type ReadyMadeBot,
  type ReadyMadeBotId,
  type RoutineSchedule,
  type RoutineWeekday,
} from "@isnadi/contracts";

import type { MessageKey } from "../i18n/index.ts";
import type { RoutineAdapterSchedule } from "../routines.ts";

/** The words the picker and the form show for one preset. `READY_MADE_BOT_COPY` holds them per id. */
export interface ReadyMadeBotCopy {
  readonly name: MessageKey;
  readonly role: MessageKey;
  readonly targetLabel: MessageKey;
  readonly targetHelp: MessageKey;
  readonly targetSchemeProblem: MessageKey;
}

const READY_MADE_BOT_COPY = new Map<ReadyMadeBotId, ReadyMadeBotCopy>([
  [
    LINK_MONITOR_BOT_ID,
    {
      name: "Link monitor",
      role: "Checks your docs on a schedule and reports every broken link.",
      targetLabel: "Docs folder or URL",
      targetHelp:
        "A folder in the bot's project, or a live site that starts with http:// or https://.",
      targetSchemeProblem:
        "Use a folder in the project, or a link that starts with http:// or https://.",
    },
  ],
]);

/** A preset added to the roster without copy has no row to show, so the picker skips it. */
export const readyMadeBotCopy = (id: ReadyMadeBotId): ReadyMadeBotCopy | null =>
  READY_MADE_BOT_COPY.get(id) ?? null;

/**
 * The preset's schedule in the routine form's shape, in the viewer's own timezone.
 * A weekly preset shows its first weekday.
 */
export function readyMadeStartSchedule(
  bot: ReadyMadeBot,
  timezone: string,
): RoutineAdapterSchedule {
  const weekday = bot.schedule.kind === "weekly" ? weekdayIndex(bot.schedule.weekdays[0]) : null;

  return {
    frequency: bot.schedule.kind,
    time: bot.schedule.time,
    timezone,
    weekday: bot.schedule.kind === "weekly" ? (weekday ?? 1) : null,
  };
}

const WEEKDAY_IDS: ReadonlyArray<RoutineWeekday> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const isWeekday = (value: string): value is RoutineWeekday =>
  WEEKDAY_IDS.some((weekday) => weekday === value);

function weekdayIndex(weekday: string | undefined) {
  if (weekday === undefined || !isWeekday(weekday)) return null;

  return WEEKDAY_IDS.indexOf(weekday);
}

/** Why a typed target cannot be used, or null when it can. */
export function readyMadeTargetProblem(target: string): "empty" | "unsupported-scheme" | null {
  const trimmed = target.trim();

  if (trimmed.length === 0) return "empty";

  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(trimmed);

  return scheme && !/^https?:\/\//i.test(trimmed) ? "unsupported-scheme" : null;
}

export interface ReadyMadeRoutineDraft {
  /** The routine's name. */
  readonly job: string;
  /** The procedure, with the target and the link budget spelled out. */
  readonly procedure: string;
  readonly schedule: RoutineSchedule;
  readonly timezone: string;
}

/**
 * The routine a ready-made bot starts with. It stays a draft: unattended runs
 * wait for the user to approve this procedure, like any other routine.
 */
export function readyMadeRoutineDraft(
  bot: ReadyMadeBot,
  input: { readonly target: string; readonly schedule: RoutineAdapterSchedule },
): ReadyMadeRoutineDraft {
  const { schedule } = input;

  return {
    job: bot.job,
    procedure: [
      bot.procedure,
      `Docs location: ${input.target.trim()}`,
      `Link budget: ${LINK_MONITOR_LINK_BUDGET} links.`,
    ].join("\n\n"),
    schedule:
      schedule.frequency === "weekly"
        ? {
            kind: "weekly",
            weekdays: [WEEKDAY_IDS[schedule.weekday ?? 1] ?? "monday"],
            time: schedule.time,
          }
        : { kind: schedule.frequency, time: schedule.time },
    timezone: schedule.timezone,
  };
}
