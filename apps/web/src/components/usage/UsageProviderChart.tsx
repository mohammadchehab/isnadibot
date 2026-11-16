import type { UsageProviderKind } from "@isnadi/contracts";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DailyTotals, HourlyTotals } from "@isnadi/shared/usageMerge";
import { useI18n } from "../../i18n";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";
import { useUsageFormat } from "./useUsageFormat";

const VIEW_WIDTH = 960;

/** Matches the plot box, so a column's height is its share of the tallest one. */
const VIEW_HEIGHT = 192;

/** The frame draws 16-wide bars on a 26 pitch. */
const BAR_WIDTH_RATIO = 0.62;

const BAR_RADIUS = 2;

/** The frame labels the axis six times. */
const AXIS_LABEL_COUNT = 6;

export type UsageChartMetric = "tokens" | "cost";

interface UsageProviderChartProps {
  readonly providers: readonly UsageProviderKind[];
  readonly days: readonly string[];
  readonly daily: readonly DailyTotals[];
  readonly hours: readonly string[];
  readonly hourly: readonly HourlyTotals[];
  readonly metric: UsageChartMetric;
  readonly referenceTime: string | undefined;
  readonly resolution: "day" | "hour";
  readonly timeZone: string;
  /** No record in the window carries a price, so no dollar figure is knowable. */
  readonly unpriced: boolean;
}

/**
 * A window with nothing priced has no dollar figure to show, so the hover readout
 * says so rather than printing `$0.00` under a caption that already says no price
 * is reported. Tokens are never unpriced, so that metric is untouched.
 *
 * The bars keep this out of reach on purpose: the plot is a scale, not a claim
 * about what a provider charged, and a column of dashes would not tell a reader
 * where the peak sits.
 */
export function usageValueFormat(
  metric: UsageChartMetric,
  unpriced: boolean,
  format: { readonly usd: (value: number) => string; readonly tokens: (value: number) => string },
): (value: number) => string {
  if (metric === "tokens") return format.tokens;

  return unpriced ? () => "—" : format.usd;
}

/** One period's per-provider values, shared by the bars and the hover readout. */
export interface DayColumn {
  readonly bands: readonly {
    readonly provider: UsageProviderKind;
    readonly value: number;
  }[];
  readonly total: number;
}

/** One stacked block: a provider's share of a single column. */
interface BarSegment {
  readonly provider: UsageProviderKind;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function valueFor(
  totals: DailyTotals | HourlyTotals | undefined,
  provider: UsageProviderKind,
  metric: UsageChartMetric,
): number {
  const entry = totals?.byProvider.get(provider);

  if (entry === undefined) return 0;

  return metric === "tokens" ? entry.totalTokens : entry.costUsd;
}

function buildPeriodColumns(
  periods: readonly string[],
  byPeriod: ReadonlyMap<string, DailyTotals | HourlyTotals>,
  metric: UsageChartMetric,
): readonly DayColumn[] {
  return periods.map((period) => {
    const entry = byPeriod.get(period);

    const bands = PROVIDER_ORDER.map((provider) => ({
      provider,
      value: valueFor(entry, provider, metric),
    }));

    return { bands, total: bands.reduce((sum, band) => sum + band.value, 0) };
  });
}

/**
 * Stacks each period's providers bottom-up into one bar, so a column's height is
 * what the window cost and its bands say who spent it.
 *
 * The scale tops out at the tallest column, not at a rounded step: with no axis
 * labels drawn there is nothing for a round maximum to line up with.
 */
function buildBarSegments(
  columns: readonly DayColumn[],
  providers: readonly UsageProviderKind[],
  pitch: number,
  peak: number,
): readonly BarSegment[] {
  const width = pitch * BAR_WIDTH_RATIO;
  const segments: BarSegment[] = [];

  columns.forEach((column, index) => {
    const x = index * pitch + (pitch - width) / 2;
    let stacked = 0;

    for (const provider of PROVIDER_ORDER) {
      if (!providers.includes(provider)) continue;

      const value = column.bands.find((band) => band.provider === provider)?.value ?? 0;
      const height = peak === 0 ? 0 : (value / peak) * VIEW_HEIGHT;

      if (height > 0) {
        segments.push({ provider, x, y: VIEW_HEIGHT - stacked - height, width, height });
      }

      stacked += height;
    }
  });

  return segments;
}

/**
 * The axis carries six evenly spaced labels, including both ends, so a reader can
 * place any column in the window without counting bars.
 */
function buildAxisLabelIndices(periodCount: number): readonly number[] {
  if (periodCount === 0) return [];

  if (periodCount <= AXIS_LABEL_COUNT) return Array.from({ length: periodCount }, (_, i) => i);

  // Both ends are labelled, so the step is shared across one fewer gap.
  const step = (periodCount - 1) / (AXIS_LABEL_COUNT - 1);

  return Array.from({ length: AXIS_LABEL_COUNT }, (_, index) => Math.round(index * step));
}

export function UsageProviderChart({
  providers,
  days,
  daily,
  hours,
  hourly,
  metric,
  referenceTime,
  resolution,
  timeZone,
  unpriced,
}: UsageProviderChartProps) {
  const fmt = useUsageFormat();
  const { direction } = useI18n();
  const periods = resolution === "hour" ? hours : days;

  const byPeriod = useMemo(
    () =>
      resolution === "hour"
        ? new Map(hourly.map((entry) => [entry.hourStart, entry]))
        : new Map(daily.map((entry) => [entry.day, entry])),
    [daily, hourly, resolution],
  );

  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hoverPositionRef = useRef<{ x: number; y: number } | null>(null);

  const { columns, peak, pitch, segments } = useMemo(() => {
    const built = buildPeriodColumns(periods, byPeriod, metric);
    const tallest = built.reduce((highest, column) => Math.max(highest, column.total), 0);
    const columnPitch = periods.length === 0 ? 0 : VIEW_WIDTH / periods.length;

    return {
      columns: built,
      peak: tallest,
      pitch: columnPitch,
      segments: buildBarSegments(built, providers, columnPitch, tallest),
    };
  }, [byPeriod, metric, periods, providers]);

  const formatTooltipValue = usageValueFormat(metric, unpriced, fmt);

  const positionTooltip = useCallback(() => {
    const plot = plotRef.current;
    const tooltip = tooltipRef.current;
    const hoverPosition = hoverPositionRef.current;

    if (plot === null || tooltip === null || hoverPosition === null) return;

    const gap = 12;
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const plotWidth = plot.clientWidth;
    const plotHeight = plot.clientHeight;

    const preferredLeft =
      hoverPosition.x + gap + tooltipWidth <= plotWidth
        ? hoverPosition.x + gap
        : hoverPosition.x - gap - tooltipWidth;

    const preferredTop =
      hoverPosition.y + gap + tooltipHeight <= plotHeight
        ? hoverPosition.y + gap
        : hoverPosition.y - gap - tooltipHeight;

    const left = Math.min(Math.max(0, preferredLeft), Math.max(0, plotWidth - tooltipWidth));
    const top = Math.min(Math.max(0, preferredTop), Math.max(0, plotHeight - tooltipHeight));
    plot.style.setProperty("--measured-usage-tooltip-left", `${left}px`);
    plot.style.setProperty("--usage-tooltip-top", `${top}px`);
  }, []);

  useLayoutEffect(() => {
    if (hoverIndex === null) return;
    positionTooltip();

    const plot = plotRef.current;
    const tooltip = tooltipRef.current;

    if (plot === null || tooltip === null || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(positionTooltip);
    observer.observe(plot);
    observer.observe(tooltip);

    return () => observer.disconnect();
  }, [hoverIndex, positionTooltip]);

  const handleMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const plot = plotRef.current;

      if (plot === null || periods.length === 0) return;
      const bounds = plot.getBoundingClientRect();

      if (bounds.width === 0) return;
      const localX = Math.min(bounds.width, Math.max(0, event.clientX - bounds.left));
      const localY = Math.min(bounds.height, Math.max(0, event.clientY - bounds.top));
      const fraction = localX / bounds.width;
      const index = Math.min(periods.length - 1, Math.floor(fraction * periods.length));
      hoverPositionRef.current = { x: localX, y: localY };
      positionTooltip();
      setHoverIndex(Math.max(0, index));
    },
    [periods.length, positionTooltip],
  );

  const hoveredPeriod = hoverIndex === null ? undefined : periods[hoverIndex];
  const hoveredColumn = hoverIndex === null ? undefined : columns[hoverIndex];
  const axisIndices = useMemo(() => buildAxisLabelIndices(periods.length), [periods.length]);

  const formatPeriod = (period: string) =>
    resolution === "hour" ? fmt.hourShort(period, timeZone) : fmt.dayShort(period);

  const formatTooltipPeriod = (period: string) =>
    resolution === "hour" && referenceTime !== undefined
      ? fmt.relativeHourShort(period, referenceTime, timeZone)
      : formatPeriod(period);

  // A blank plot reads as broken; the breakdown below already says this, so match it.
  if (peak === 0) {
    return (
      <p className="flex h-31 items-center justify-center text-sm text-muted-foreground sm:h-48">
        No activity in this window.
      </p>
    );
  }

  return (
    <div dir="ltr" className="flex flex-col gap-1">
      <div
        ref={plotRef}
        // The frame's phone card is 160 tall and its desktop card 236, so the
        // plot gives up the difference rather than letting the card grow.
        className="relative h-31 sm:h-48"
        onMouseMove={handleMove}
        onMouseLeave={() => {
          hoverPositionRef.current = null;
          setHoverIndex(null);
        }}
      >
        <svg
          className="h-full w-full"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${resolution === "hour" ? "Hourly" : "Daily"} ${metric === "tokens" ? "processed tokens" : "cost"} by provider`}
        >
          {hoverIndex === null ? null : (
            <rect
              x={hoverIndex * pitch}
              y={0}
              width={pitch}
              height={VIEW_HEIGHT}
              fill="currentColor"
              className="text-muted-foreground/10"
            />
          )}

          {segments.map((segment) => (
            <rect
              key={`${segment.provider}:${segment.x}`}
              x={segment.x}
              y={segment.y}
              width={segment.width}
              height={segment.height}
              rx={BAR_RADIUS}
              fill={PROVIDER_PRESENTATION[segment.provider].color}
            />
          ))}
        </svg>

        {hoveredPeriod === undefined ? null : (
          <div
            ref={tooltipRef}
            dir={direction}
            className="surface-glass pointer-events-none absolute top-(--usage-tooltip-top,0px) left-(--measured-usage-tooltip-left,0px) z-10 min-w-36 max-w-full rounded-xl border border-border/50 px-2.5 py-2 text-xs shadow-lg"
          >
            <div className="mb-1 text-muted-foreground">{formatTooltipPeriod(hoveredPeriod)}</div>
            {providers.map((provider) => {
              const { label, mark: Mark } = PROVIDER_PRESENTATION[provider];

              return (
                <div key={provider} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Mark className="size-3 shrink-0" aria-hidden />
                    {label}
                  </span>
                  <span className="text-foreground tabular-nums">
                    {formatTooltipValue(
                      hoveredColumn?.bands.find((band) => band.provider === provider)?.value ?? 0,
                    )}
                  </span>
                </div>
              );
            })}
            <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1">
              <span className="text-muted-foreground">Total</span>
              <span className="text-foreground tabular-nums">
                {formatTooltipValue(hoveredColumn?.total ?? 0)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-11px text-muted-foreground">
        {axisIndices.map((index) => (
          <span key={index}>
            {periods[index] === undefined ? "" : formatPeriod(periods[index])}
          </span>
        ))}
      </div>
    </div>
  );
}
