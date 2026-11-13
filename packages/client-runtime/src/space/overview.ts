import type { RoutineLifecycle } from "@isnadi/contracts";
import * as DateTime from "effect/DateTime";

import type { Decision } from "../decisions.ts";

/** The parts of a group a space view reads. A web `Group` satisfies it. */
export interface SpaceGroup {
  readonly id: string;
  readonly bossBotId: string | null;
  readonly members: ReadonlyArray<{ readonly kind?: string; readonly botId?: string }>;
  readonly updatedAt: string;
}

/** The parts of a routine the Overview reads. */
export interface SpaceRoutine {
  readonly botId: string;
  readonly enabled: boolean;
  readonly lifecycle: RoutineLifecycle;
  readonly nextRunAt: string | null;
}

export interface SpaceRoutineSummary {
  readonly active: number;
  readonly nextRunAt: string | null;
}

export const SPACE_ACTIVITY_LIMIT = 20;

/** The bots in a space: its group members and its boss, once each. */
export function spaceMembers(group: SpaceGroup): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const member of group.members) {
    if (member.kind !== "person" && member.botId !== undefined) ids.add(member.botId);
  }

  if (group.bossBotId !== null) ids.add(group.bossBotId);

  return ids;
}

/** What places an item (decision, chat) in a space: its group, or the bot that owns it. */
interface SpaceOwned {
  readonly botId?: string | null | undefined;
  readonly groupId?: string | null | undefined;
}

function inSpace(owner: SpaceOwned, group: SpaceGroup, members: ReadonlySet<string>) {
  if (owner.groupId === group.id) return true;

  return owner.groupId == null && owner.botId != null && members.has(owner.botId);
}

/** Decisions waiting in the space's group chats or in a member's own chats. */
export function spaceDecisions(
  decisions: ReadonlyArray<Decision>,
  group: SpaceGroup,
): ReadonlyArray<Decision> {
  const members = spaceMembers(group);

  return decisions.filter((decision) => inSpace(decision, group, members));
}

/** Enabled routines owned by a member, with the soonest next run. */
export function spaceRoutines(
  routines: ReadonlyArray<SpaceRoutine>,
  group: SpaceGroup,
): SpaceRoutineSummary {
  const members = spaceMembers(group);
  let active = 0;
  let nextRunAt: string | null = null;

  for (const routine of routines) {
    if (!members.has(routine.botId) || !routine.enabled || routine.lifecycle === "deleted")
      continue;

    active += 1;

    if (routine.nextRunAt !== null && (nextRunAt === null || routine.nextRunAt < nextRunAt)) {
      nextRunAt = routine.nextRunAt;
    }
  }

  return { active, nextRunAt };
}

/**
 * The space's chats, waiting ones first, then newest first, capped. Shells carry no message
 * bodies, so a row is a chat title.
 */
export function spaceActivity<
  T extends SpaceOwned & {
    readonly id: string;
    readonly updatedAt: string;
    readonly archivedAt: string | null;
  },
>(
  shells: ReadonlyArray<T>,
  group: SpaceGroup,
  waitingThreadIds: ReadonlySet<string>,
  limit: number = SPACE_ACTIVITY_LIMIT,
): ReadonlyArray<T> {
  const members = spaceMembers(group);

  return shells
    .filter((shell) => shell.archivedAt === null && inSpace(shell, group, members))
    .toSorted((a, b) => {
      const waiting = Number(waitingThreadIds.has(b.id)) - Number(waitingThreadIds.has(a.id));

      return waiting !== 0 ? waiting : b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, limit);
}

/**
 * When the space last moved: the group's own stamp or the newest decision or chat on it,
 * whichever is later.
 */
export function spaceUpdatedAt(
  group: SpaceGroup,
  decisions: ReadonlyArray<{ readonly updatedAt: string }>,
  activity: ReadonlyArray<{ readonly updatedAt: string }>,
): string {
  return [...decisions, ...activity].reduce(
    (latest, item) => (Date.parse(item.updatedAt) > Date.parse(latest) ? item.updatedAt : latest),
    group.updatedAt,
  );
}

/** One member bot's answer for the space's usage window. */
export type SpaceUsageAnswer =
  | { readonly status: "ready"; readonly turns: number }
  | { readonly status: "pending" }
  | { readonly status: "failed" };

/**
 * What the Usage tile shows. A partial sum is not a final number, so the caller
 * renders pending and failed answers instead of a total that looks settled.
 */
export interface SpaceUsageSummary {
  readonly turns: number;
  readonly isPending: boolean;
  readonly hasError: boolean;
}

/** Sums the members' turns over the space's usage window. */
export function spaceUsageTurns(answers: Iterable<SpaceUsageAnswer>): SpaceUsageSummary {
  let turns = 0;
  let isPending = false;
  let hasError = false;

  for (const answer of answers) {
    if (answer.status === "ready") {
      turns += answer.turns;
    } else if (answer.status === "pending") {
      isPending = true;
    } else {
      hasError = true;
    }
  }

  return { turns, isPending, hasError };
}

function zoneParts(instant: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });

  const parts = formatter.formatToParts(instant);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")),
  };
}

function zoneOffsetMs(instant: number, timeZone: string) {
  const p = zoneParts(instant, timeZone);

  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(instant / 1000) * 1000
  );
}

interface WeekInfoLocale {
  readonly getWeekInfo?: () => { readonly firstDay: number };
  readonly weekInfo?: { readonly firstDay: number };
}

/** First day of the week for `locale` (1 = Monday ... 7 = Sunday); Monday when the runtime has no week data. */
function localeFirstDay(locale: string | undefined): number {
  if (!locale) return 1;

  try {
    // Runtimes expose either the getWeekInfo() method or the older weekInfo property.
    const intlLocale: WeekInfoLocale & Intl.Locale = new Intl.Locale(locale);
    const firstDay = (intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo)?.firstDay;

    return firstDay !== undefined && firstDay >= 1 && firstDay <= 7 ? firstDay : 1;
  } catch {
    return 1;
  }
}

/**
 * Start of the week (00:00 on the locale's first day, Monday by default) in `timeZone` for the
 * week holding `now`, as an ISO instant. The wall-clock day is converted back to an instant with
 * the offset in force on that day, so a DST change inside the week does not shift it by an hour.
 */
export function weekStart(now: Date, timeZone: string, locale?: string): string {
  const local = zoneParts(now.getTime(), timeZone);
  const daysBack = (local.weekday - (localeFirstDay(locale) - 1) + 7) % 7;
  const wallStart = Date.UTC(local.year, local.month - 1, local.day - daysBack);
  const guess = wallStart - zoneOffsetMs(wallStart, timeZone);
  const instant = wallStart - zoneOffsetMs(guess, timeZone);

  return DateTime.formatIso(DateTime.makeUnsafe(instant));
}
