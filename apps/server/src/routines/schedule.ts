import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { RoutineSchedule, RoutineWeekday } from "./types.ts";

export class RoutineScheduleError extends Schema.TaggedErrorClass<RoutineScheduleError>()(
  "RoutineScheduleError",
  { detail: Schema.String },
) {}

const parseTime = (time: string): readonly [hour: number, minute: number] => {
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);

  if (match === null) throw new RoutineScheduleError({ detail: `Invalid routine time: ${time}` });

  return [Number(time.slice(0, 2)), Number(time.slice(3, 5))];
};

const matchesDay = (schedule: RoutineSchedule, weekDay: number) => {
  switch (schedule.kind) {
    case "daily":
      return true;
    case "weekdays":
      return weekDay >= 1 && weekDay <= 5;
    case "weekly":
      return schedule.weekdays.includes(weekdays[weekDay]!);
    case "interval":
      return true;
  }
};

const weekdays: ReadonlyArray<RoutineWeekday> = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const atLocalTime = (
  day: DateTime.Zoned,
  hour: number,
  minute: number,
  timezone: string,
): DateTime.Zoned => {
  const parts = DateTime.toParts(day);

  const candidate = DateTime.makeZoned(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour,
      minute,
    },
    { timeZone: timezone, adjustForTimeZone: true },
  );

  if (Option.isNone(candidate)) {
    throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
  }

  return candidate.value;
};

/**
 * Every instant a schedule lands on inside one day, earliest first. An interval
 * routine lands once per interval from local midnight; the others land once.
 */
const candidatesForDay = (
  day: DateTime.Zoned,
  schedule: RoutineSchedule,
  timezone: string,
): ReadonlyArray<DateTime.Zoned> => {
  if (schedule.kind === "interval") {
    return Array.from({ length: 24 / schedule.everyHours }, (_unused, index) =>
      atLocalTime(day, index * schedule.everyHours, 0, timezone),
    );
  }

  const [hour, minute] = parseTime(schedule.time);

  return [atLocalTime(day, hour, minute, timezone)];
};

/** The last slot a day offers at or before `epochMillis`, or none when the whole day is ahead. */
const lastAtOrBefore = (
  candidates: ReadonlyArray<DateTime.Zoned>,
  epochMillis: number,
): DateTime.Zoned | undefined =>
  candidates.reduce<DateTime.Zoned | undefined>(
    (found, candidate) => (DateTime.toEpochMillis(candidate) <= epochMillis ? candidate : found),
    undefined,
  );

export const latestScheduledFor = (
  schedule: RoutineSchedule,
  timezone: string,
  nowEpochMillis: number,
): string => {
  const now = DateTime.makeZoned(nowEpochMillis, { timeZone: timezone });

  if (Option.isNone(now)) {
    throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
  }

  for (let daysBack = 0; daysBack <= 7; daysBack += 1) {
    const day = DateTime.subtract(now.value, { days: daysBack });

    if (!matchesDay(schedule, DateTime.toParts(day).weekDay)) continue;

    const found = lastAtOrBefore(candidatesForDay(day, schedule, timezone), nowEpochMillis);

    if (found !== undefined) return DateTime.formatIso(found);
  }

  throw new RoutineScheduleError({ detail: "Routine schedule has no matching day." });
};

export const nextScheduledFor = (
  schedule: RoutineSchedule,
  timezone: string,
  afterEpochMillis: number,
): string => {
  const after = DateTime.makeZoned(afterEpochMillis, { timeZone: timezone });

  if (Option.isNone(after)) {
    throw new RoutineScheduleError({ detail: `Invalid routine timezone: ${timezone}` });
  }

  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    const day = DateTime.add(after.value, { days: daysAhead });

    if (!matchesDay(schedule, DateTime.toParts(day).weekDay)) continue;

    const found = candidatesForDay(day, schedule, timezone).find(
      (candidate) => DateTime.toEpochMillis(candidate) > afterEpochMillis,
    );

    if (found !== undefined) return DateTime.formatIso(found);
  }

  throw new RoutineScheduleError({ detail: "Routine schedule has no matching day." });
};
