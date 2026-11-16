import { ChevronLeftIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@isnadi/shared/usageMerge";
import { useCanGoBack, useNavigate } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { useClientSettings } from "../../hooks/useSettings";
import { useI18n } from "../../i18n";
import { useUsage } from "../../state/usage";
import { enumerateDays, enumerateHourStarts, makeWindow } from "@isnadi/shared/usageFormat";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { PLAN_PROVIDER_ORDER } from "./UsageCharts";
import { UsageProviderChart } from "./UsageProviderChart";
import { PROVIDER_PRESENTATION, providersWithUsage } from "./usageProviders";
import {
  isUsageMetric,
  isUsageWindowDays,
  METRIC_OPTIONS,
  readUsagePagePreferences,
  saveUsagePagePreferences,
  type UsageMetric,
  WINDOW_OPTIONS,
} from "./usagePagePreferences";
import {
  Metric,
  ProviderMark,
  UsageCoverageNotice,
  UsageDeviceStrip,
  UsageLimitsOverview,
  UsageProviderRow,
  UsageSkeleton,
} from "./UsagePageSections";
import { useUsageFormat } from "./useUsageFormat";

export function UsagePage() {
  const fmt = useUsageFormat();
  const { t } = useI18n();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const [preferences, setPreferences] = useState(readUsagePagePreferences);

  const [windowSelection, setWindowSelection] = useState(() => ({
    days: preferences.windowDays,
    window: makeWindow(
      preferences.windowDays,
      undefined,
      preferences.windowDays === 1 ? "hour" : "day",
    ),
  }));

  const metric = preferences.metric;
  const showingLimits = metric === "limits";
  const [breakdown, setBreakdown] = useState<"model" | "time">("model");
  const { days: windowDays, window } = windowSelection;
  const isPast24Hours = windowDays === 1;
  const { merged, environments, isPending, isPartial, refresh } = useUsage(window);
  const refreshMinutes = useClientSettings((settings) => settings.usageRefreshMinutes);

  const planLimits = PLAN_PROVIDER_ORDER.map((provider) =>
    merged.planLimits.find((entry) => entry.provider === provider && entry.status === "ok"),
  ).filter((entry) => entry !== undefined);

  useEffect(() => {
    const timer = globalThis.setInterval(refresh, Math.max(1, refreshMinutes) * 60 * 1000);

    return () => globalThis.clearInterval(timer);
  }, [refresh, refreshMinutes]);

  const days = useMemo(
    () => enumerateDays(window.sinceDay, window.untilDay),
    [window.sinceDay, window.untilDay],
  );

  const hours = useMemo(
    () =>
      window.sinceTime === undefined || window.untilTime === undefined
        ? []
        : enumerateHourStarts(window.sinceTime, window.untilTime),
    [window.sinceTime, window.untilTime],
  );

  // Newest first: the window can run 90 periods, so the interesting end
  // belongs at the top of the table.
  const breakdownPeriods = useMemo<readonly (DailyTotals | HourlyTotals)[]>(
    () => (isPast24Hours ? merged.hourly : merged.daily).toReversed(),
    [isPast24Hours, merged.daily, merged.hourly],
  );

  const breakdownModels = useMemo(
    () =>
      breakdown === "model" && metric === "tokens"
        ? merged.models.toSorted(
            (left, right) => right.totalTokens - left.totalTokens || right.costUsd - left.costUsd,
          )
        : merged.models,
    [breakdown, merged.models, metric],
  );

  const activeProviders = useMemo(() => providersWithUsage(merged.providers), [merged.providers]);
  // Every record unpriced is not the same claim as "spent nothing", so the
  // headline refuses to print `$0.00` for it. `unpricedShare` is 0 for an empty
  // window, which the empty state already covers.
  const entirelyUnpriced = merged.costQuality.unpricedShare === 1;
  // One window, one answer. When nothing in it carries a price, every dollar
  // cell on the page says so, rather than the headline saying "unknown" above a
  // column of `$0.00`. Cache savings is a separate claim and keeps its figure.
  const costLabel = (usd: number) => (entirelyUnpriced ? "—" : fmt.usd(usd));

  // Opened from the sidebar footer, Usage is a page you come back from, so the
  // top bar carries a way out. A deep link has no history to pop, and lands on
  // the workspace instead.
  const navigateBack = useCallback(() => {
    if (canGoBack) {
      // `window` in this scope is the usage window, so reach the browser's.
      globalThis.history.back();

      return;
    }

    void navigate({ to: "/" });
  }, [canGoBack, navigate]);

  const selectWindow = (days: number) => {
    if (!isUsageWindowDays(days)) return;
    const nextPreferences = { metric, windowDays: days };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
    setWindowSelection({
      days,
      window: makeWindow(days, undefined, days === 1 ? "hour" : "day"),
    });
  };

  const selectMetric = (nextMetric: UsageMetric) => {
    const nextPreferences = { metric: nextMetric, windowDays };
    setPreferences(nextPreferences);
    saveUsagePagePreferences(nextPreferences);
  };

  const refreshWindow = () => {
    if (showingLimits) {
      refresh();

      return;
    }

    const nextWindow = makeWindow(windowDays, undefined, isPast24Hours ? "hour" : "day");

    if (
      nextWindow.sinceDay === window.sinceDay &&
      nextWindow.untilDay === window.untilDay &&
      nextWindow.sinceTime === window.sinceTime &&
      nextWindow.untilTime === window.untilTime
    ) {
      refresh();
    } else {
      setWindowSelection({ days: windowDays, window: nextWindow });
    }
  };

  const topbarContent = (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Button
        onClick={navigateBack}
        aria-label="Back"
        size="icon-sm"
        variant="ghost"
        className="-ms-1.5"
      >
        <ChevronLeftIcon aria-hidden className="size-4 rtl:-scale-x-100" />
      </Button>
      <h1 className="min-w-0 truncate text-base font-semibold text-foreground">Usage</h1>
      <div className="ms-auto hidden min-w-0 items-center justify-end gap-2 lg:flex">
        <ToggleGroup
          aria-label="Usage metric"
          variant="segmented"
          value={[metric]}
          onValueChange={(next) => {
            const value = next[0];

            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          {METRIC_OPTIONS.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
      <div className="ms-auto flex min-w-0 items-center justify-end gap-1 lg:hidden">
        <Select
          value={metric}
          onValueChange={(value) => {
            if (isUsageMetric(value)) selectMetric(value);
          }}
        >
          <SelectTrigger
            aria-label="Usage metric"
            size="compact"
            variant="ghost"
            className="w-auto min-w-0"
          >
            <SelectValue>
              {METRIC_OPTIONS.find((option) => option.value === metric)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {METRIC_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          onClick={refreshWindow}
          aria-label={showingLimits ? "Refresh limits" : "Refresh usage"}
          size="icon-sm"
          variant="ghost"
        >
          <RefreshCwIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>{topbarContent}</WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded" className="px-4 sm:px-10">
            {showingLimits ? (
              <UsageLimitsOverview
                planLimits={planLimits}
                environments={environments}
                isPending={isPending}
              />
            ) : isPending ? (
              <>
                {environments.length > 1 ? <UsageDeviceStrip environments={environments} /> : null}
                <UsageSkeleton />
              </>
            ) : merged.staleEnvironments.length > 0 && merged.connectedProviders.length === 0 ? (
              <UsageCoverageNotice
                environments={environments}
                duplicateSources={merged.duplicateSources}
                staleEnvironments={merged.staleEnvironments}
                onRetry={refresh}
              />
            ) : merged.connectedProviders.length === 0 ? (
              <div className="rounded-xl border border-border/70 px-5 py-6">
                <h2 className="text-sm font-medium text-foreground">No provider usage yet</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect a provider in Settings to start tracking usage.
                </p>
              </div>
            ) : (
              <>
                {isPartial && environments.length > 1 ? (
                  <UsageDeviceStrip environments={environments} />
                ) : null}
                <UsageCoverageNotice
                  environments={environments}
                  duplicateSources={merged.duplicateSources}
                  staleEnvironments={merged.staleEnvironments}
                />

                <section className="grid gap-6 lg:grid-cols-18rem-1fr">
                  <div className="flex min-w-0 flex-col gap-5">
                    <div className="flex flex-col gap-1">
                      <span className="text-4xl font-semibold text-foreground tabular-nums">
                        {metric === "cost"
                          ? entirelyUnpriced
                            ? "—"
                            : fmt.usd(merged.costUsd)
                          : fmt.tokens(merged.totalTokens)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {metric === "cost"
                          ? entirelyUnpriced
                            ? "No provider reports a price for this period."
                            : merged.costQuality.unpricedShare > 0
                              ? `${fmt.count(merged.sessions)} sessions · estimate excludes ${fmt.percent(merged.costQuality.unpricedShare)} unpriced records`
                              : `${fmt.count(merged.sessions)} sessions · API estimate`
                          : `${fmt.count(merged.sessions)} sessions`}
                      </span>
                    </div>

                    {activeProviders.map((provider) => {
                      const totals = merged.providers.find((entry) => entry.provider === provider);

                      const share =
                        metric === "cost" ? (totals?.costShare ?? 0) : (totals?.tokenShare ?? 0);

                      const providerSessions = totals?.sessions ?? 0;

                      return (
                        <UsageProviderRow
                          key={provider}
                          provider={provider}
                          sessions={`${fmt.count(providerSessions)} ${
                            providerSessions === 1 ? "session" : "sessions"
                          }`}
                          value={
                            metric === "cost"
                              ? costLabel(totals?.costUsd ?? 0)
                              : fmt.tokens(totals?.totalTokens ?? 0)
                          }
                          share={fmt.percent(share)}
                          detail={
                            metric === "cost"
                              ? `${fmt.percent(share)} of cost · ${fmt.tokens(totals?.totalTokens ?? 0)} tokens`
                              : `${fmt.percent(share)} of tokens · ${costLabel(totals?.costUsd ?? 0)}`
                          }
                        />
                      );
                    })}

                    {metric === "cost" ? (
                      <p className="text-xs text-muted-foreground">
                        {t("Estimated from reported model usage; this is not subscription spend.")}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-col gap-3">
                    {/* The period only shapes the series and the breakdown below
                        it, so it sits with them instead of competing with the
                        metric control in the top bar. */}
                    <div className="flex items-center gap-2">
                      <Select
                        value={String(windowDays)}
                        onValueChange={(value) => selectWindow(Number(value))}
                      >
                        <SelectTrigger aria-label="Usage period" size="compact" className="w-35">
                          <SelectValue>
                            {WINDOW_OPTIONS.find((option) => option.days === windowDays)?.label}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup>
                          {WINDOW_OPTIONS.map((option) => (
                            <SelectItem key={option.days} value={String(option.days)}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <div className="rounded-xl border border-border p-2">
                      <UsageProviderChart
                        providers={activeProviders}
                        days={days}
                        daily={merged.daily}
                        hours={hours}
                        hourly={merged.hourly}
                        metric={metric}
                        referenceTime={window.untilTime}
                        resolution={isPast24Hours ? "hour" : "day"}
                        timeZone={window.timeZone}
                        unpriced={entirelyUnpriced}
                      />
                    </div>
                  </div>
                </section>

                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium text-foreground">Totals</h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
                    <Metric label="Processed tokens" value={fmt.tokens(merged.totalTokens)} />
                    <Metric label="Cached input" value={fmt.tokens(merged.cachedInputTokens)} />
                    <Metric label="Uncached input" value={fmt.tokens(merged.uncachedInputTokens)} />
                    <Metric label="Output" value={fmt.tokens(merged.outputTokens)} />
                    <Metric
                      label="Cache savings"
                      value={fmt.usd(merged.costQuality.cacheSavingsUsd)}
                    />
                  </div>
                </section>

                <section className="rounded-xl border border-border">
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <h2 className="text-sm font-medium text-foreground">
                      {breakdown === "model" ? "By model" : "By time"}
                    </h2>
                    <ToggleGroup
                      aria-label="Usage breakdown"
                      variant="segmented"
                      value={[breakdown]}
                      onValueChange={(next) => {
                        const value = next[0];

                        if (value === "model" || value === "time") setBreakdown(value);
                      }}
                    >
                      <Toggle value="model">By model</Toggle>
                      <Toggle value="time">By time</Toggle>
                    </ToggleGroup>
                  </div>

                  {breakdown === "model" ? (
                    // Model names and five numeric columns stop fitting well
                    // before the narrowest supported width, so the table keeps a
                    // readable minimum and scrolls rather than crushing columns.
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full min-w-136 table-fixed text-sm">
                        <colgroup>
                          <col className="w-2/5" />
                          <col className="w-1/5" />
                          <col className="w-1/5" />
                          <col className="w-1/5" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-border text-start text-11px text-muted-foreground">
                            <th className="h-9 px-4 text-start font-normal">Model</th>
                            <th className="h-9 px-4 text-end font-normal">Cost</th>
                            <th className="h-9 px-4 text-end font-normal">Share</th>
                            <th className="h-9 px-4 text-end font-normal">Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdownModels.length === 0 ? (
                            <tr>
                              <td
                                colSpan={4}
                                className="px-4 py-6 text-center text-muted-foreground"
                              >
                                No activity in this window.
                              </td>
                            </tr>
                          ) : (
                            breakdownModels.map((model) => (
                              <tr
                                key={`${model.provider}:${model.model}`}
                                className="h-10 border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/50"
                              >
                                <td className="px-4 text-foreground">
                                  <span className="flex items-center gap-2">
                                    <ProviderMark provider={model.provider} className="size-3.5" />
                                    {PROVIDER_PRESENTATION[model.provider].label} · {model.model}
                                  </span>
                                </td>
                                <td className="px-4 text-end text-foreground tabular-nums">
                                  {costLabel(model.costUsd)}
                                </td>
                                <td className="px-4 text-end text-muted-foreground tabular-nums">
                                  {fmt.percent(model.costShare)}
                                </td>
                                <td className="px-4 text-end text-muted-foreground tabular-nums">
                                  {fmt.tokens(model.totalTokens)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="overflow-x-auto border-t border-border">
                      <table className="w-full min-w-136 table-fixed text-sm">
                        <colgroup>
                          <col />
                          <col className="w-28" />
                          <col className="w-28" />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-border text-start text-11px text-muted-foreground">
                            <th className="h-9 px-4 text-start font-normal">Period</th>
                            <th className="h-9 px-4 text-end font-normal">Cost</th>
                            <th className="h-9 px-4 text-end font-normal">Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdownPeriods.length === 0 ? (
                            <tr>
                              <td
                                colSpan={3}
                                className="px-4 py-6 text-center text-muted-foreground"
                              >
                                No activity in this window.
                              </td>
                            </tr>
                          ) : (
                            breakdownPeriods.map((period) => (
                              <tr
                                key={"hourStart" in period ? period.hourStart : period.day}
                                className="h-10 border-b border-border/50 transition-colors last:border-b-0 hover:bg-muted/50"
                              >
                                <td className="px-4 text-foreground">
                                  {"hourStart" in period
                                    ? fmt.hourShort(period.hourStart, window.timeZone)
                                    : fmt.dayShort(period.day)}
                                </td>
                                <td className="px-4 text-end text-foreground tabular-nums">
                                  {costLabel(period.costUsd)}
                                </td>
                                <td className="px-4 text-end text-muted-foreground tabular-nums">
                                  {fmt.tokens(period.totalTokens)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
