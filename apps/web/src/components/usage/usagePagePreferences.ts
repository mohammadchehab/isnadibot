import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "../../hooks/useLocalStorage";
import type { UsageChartMetric } from "./UsageProviderChart";

const UsagePagePreferencesSchema = Schema.Struct({
  metric: Schema.Literals(["cost", "tokens", "limits"]),
  windowDays: Schema.Literals([1, 7, 30, 90]),
});

export type UsagePagePreferences = typeof UsagePagePreferencesSchema.Type;

const STORAGE_KEY = "isnadi:usage-page-preferences:v1";

// Cost first: a user opening Usage is deciding about spend, not reading a
// subscription meter. Limits stays one toggle away.
const DEFAULT_PREFERENCES: UsagePagePreferences = { metric: "cost", windowDays: 30 };

export function readUsagePagePreferences(): UsagePagePreferences {
  try {
    return getLocalStorageItem(STORAGE_KEY, UsagePagePreferencesSchema) ?? DEFAULT_PREFERENCES;
  } catch (error) {
    console.error("Could not read Usage page preferences.", error);

    return DEFAULT_PREFERENCES;
  }
}

export function saveUsagePagePreferences(preferences: UsagePagePreferences): void {
  try {
    setLocalStorageItem(STORAGE_KEY, preferences, UsagePagePreferencesSchema);
  } catch (error) {
    console.error("Could not save Usage page preferences.", error);
    // A private or locked-down browser can deny storage. The page still works
    // for the current visit, so persistence remains best effort.
  }
}

export type UsageMetric = UsageChartMetric | "limits";

export const METRIC_OPTIONS = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "limits", label: "Limits" },
] as const satisfies readonly { value: UsageMetric; label: string }[];

/** One shape for every window, because the select shows the chosen label alone. */
export const WINDOW_OPTIONS = [
  { days: 1, label: "Past 24 hours" },
  { days: 7, label: "Past 7 days" },
  { days: 30, label: "Past 30 days" },
  { days: 90, label: "Past 90 days" },
] as const;

export function isUsageMetric(value: string | null | undefined): value is UsageMetric {
  return METRIC_OPTIONS.some((option) => option.value === value);
}

export function isUsageWindowDays(value: number): value is UsagePagePreferences["windowDays"] {
  return WINDOW_OPTIONS.some((option) => option.days === value);
}
