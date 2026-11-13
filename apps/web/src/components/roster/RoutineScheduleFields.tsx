import type {
  RoutineAdapterFrequency,
  RoutineAdapterSchedule,
} from "@isnadi/client-runtime/routines";
import type { MessageKey } from "@isnadi/client-runtime/i18n";

import { useI18n } from "../../i18n";
import { Input } from "../ui/input";

export const WEEKDAYS: readonly MessageKey[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** The schedule controls a routine draft carries, shared by the routine form and the ready-made bot form. */
export function RoutineScheduleFields({
  schedule,
  onChange,
}: {
  readonly schedule: RoutineAdapterSchedule;
  readonly onChange: (schedule: RoutineAdapterSchedule) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1.5 text-sm">
          <span>{t("Schedule")}</span>
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={schedule.frequency}
            onChange={(event) =>
              onChange({
                ...schedule,
                // SAFETY: the only options are the three RoutineAdapterFrequency kinds below.
                frequency: event.target.value as RoutineAdapterFrequency,
                weekday: event.target.value === "weekly" ? (schedule.weekday ?? 1) : null,
              })
            }
          >
            <option value="daily">{t("Daily")}</option>
            <option value="weekdays">{t("Weekdays")}</option>
            <option value="weekly">{t("Weekly")}</option>
          </select>
        </label>
        <label className="space-y-1.5 text-sm">
          <span>{t("Time")}</span>
          <Input
            type="time"
            value={schedule.time}
            onChange={(event) => onChange({ ...schedule, time: event.target.value })}
          />
        </label>
      </div>
      {schedule.frequency === "weekly" ? (
        <label className="block space-y-1.5 text-sm">
          <span>{t("Day")}</span>
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={schedule.weekday ?? 1}
            onChange={(event) => onChange({ ...schedule, weekday: Number(event.target.value) })}
          >
            {WEEKDAYS.map((day, index) => (
              <option key={day} value={index}>
                {t(day)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="block space-y-1.5 text-sm">
        <span>{t("Timezone")}</span>
        <Input
          value={schedule.timezone}
          onChange={(event) => onChange({ ...schedule, timezone: event.target.value })}
        />
      </label>
    </div>
  );
}
