import type { UsageProviderKind, UsageProviderPlanLimits } from "@isnadi/contracts";
import { CheckIcon, XIcon } from "lucide-react";

import { cn } from "../../lib/utils";
import type { EnvironmentUsageStatus } from "@isnadi/client-runtime/usage";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { UsagePlanMeters } from "./UsageCharts";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION } from "./usageProviders";

export function UsageLimitsOverview({
  planLimits,
  environments,
  isPending,
}: {
  readonly planLimits: readonly UsageProviderPlanLimits[];
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly isPending: boolean;
}) {
  if (isPending && planLimits.length === 0) {
    return <UsageSkeleton />;
  }

  return (
    <div className="flex flex-col gap-9">
      {environments.length > 1 ? <UsageDeviceStrip environments={environments} /> : null}
      {planLimits.length > 0 ? (
        planLimits.map((limits) => <UsagePlanMeters key={limits.provider} limits={limits} />)
      ) : environments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Connect an environment to see usage.</p>
      ) : (
        <div className="rounded-xl border border-border/70 px-5 py-6">
          <h2 className="text-sm font-medium text-foreground">No subscription limits yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect a provider subscription in Settings, then refresh this page.
          </p>
        </div>
      )}
    </div>
  );
}

/** Brand mark for the harness a row belongs to. */
export function ProviderMark({
  provider,
  className,
}: {
  readonly provider: UsageProviderKind;
  readonly className: string;
}) {
  const Mark = PROVIDER_PRESENTATION[provider].mark;

  return <Mark className={cn("shrink-0", className)} aria-hidden />;
}

export function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

/**
 * One provider's share of the window: who it is and how many sessions it ran on
 * the left, what it cost and how much of the window that was on the right.
 *
 * Below `sm` the row collapses to the frame's single line, `Claude · $6.02 ·
 * 47%`, because two stacked lines per provider would push the chart off a phone.
 */
export function UsageProviderRow({
  provider,
  sessions,
  value,
  detail,
  share,
}: {
  readonly provider: UsageProviderKind;
  readonly sessions: string;
  readonly value: string;
  readonly detail: string;
  readonly share: string;
}) {
  const { color, label } = PROVIDER_PRESENTATION[provider];

  return (
    <>
      <div className="flex items-center gap-1.5 text-sm sm:hidden">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-(--provider-color)"
          style={{ "--provider-color": color }}
        />
        <span className="truncate text-foreground">{label}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          · {value} · {share}
        </span>
      </div>

      <div className="hidden items-start justify-between gap-4 sm:flex">
        <div className="flex min-w-0 items-start gap-2">
          <span
            aria-hidden
            className="mt-1.5 size-2 shrink-0 rounded-full bg-(--provider-color)"
            style={{ "--provider-color": color }}
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-foreground">{label}</span>
            <span className="text-11px text-muted-foreground tabular-nums">{sessions}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end">
          <span className="text-sm font-medium text-foreground tabular-nums">{value}</span>
          <span className="text-11px text-muted-foreground tabular-nums">{detail}</span>
        </div>
      </div>
    </>
  );
}

/**
 * Says plainly when the totals are incomplete: an environment that failed, or
 * one whose transcripts another environment already reported. Environments
 * that are still answering never reach this notice; the page shows the
 * loading skeleton until every one is terminal.
 *
 * A failed environment gets the frame's red row and a retry, because that is
 * the one case where asking again is what fixes it.
 */
export function UsageCoverageNotice({
  environments,
  duplicateSources,
  staleEnvironments,
  onRetry,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
  readonly duplicateSources: readonly string[];
  readonly staleEnvironments: readonly string[];
  readonly onRetry?: (() => void) | undefined;
}) {
  const failed = environments.filter((environment) => environment.error !== null);

  const stale = environments.filter((environment) =>
    staleEnvironments.includes(environment.environmentId),
  );

  if (failed.length === 0 && stale.length === 0 && duplicateSources.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1 border border-border px-3 py-2 text-xs text-muted-foreground">
      {failed.map((environment) => (
        <div key={environment.label} className="flex items-center justify-between gap-2">
          <span className="text-destructive">{environment.label} could not report usage.</span>
          {onRetry === undefined ? null : (
            <Button type="button" size="xs" variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>
      ))}
      {stale.map((environment) => (
        <span key={environment.label}>
          {environment.label} runs an older server version and is excluded from totals.
        </span>
      ))}
      {duplicateSources.length > 0 ? (
        <span>
          Counted once across clients sharing an environment usage store:{" "}
          {duplicateSources.join(", ")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Per-device progress while the page waits for every environment to answer.
 * Only rendered with two or more devices; a lone device has nothing to
 * enumerate.
 */
export function UsageDeviceStrip({
  environments,
}: {
  readonly environments: readonly EnvironmentUsageStatus[];
}) {
  const scanning = environments.filter(
    (environment) => environment.summary === null && environment.error === null,
  );

  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border border-border px-3 py-2 text-xs">
      {environments.map((environment) => {
        if (environment.summary !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-foreground"
            >
              <CheckIcon className="size-3 text-success-foreground" aria-hidden />
              {environment.label}
            </span>
          );
        }

        if (environment.error !== null) {
          return (
            <span
              key={environment.environmentId}
              className="flex items-center gap-1 text-destructive"
            >
              <XIcon className="size-3" aria-hidden />
              {environment.label}
            </span>
          );
        }

        return (
          <span
            key={environment.environmentId}
            className="animate-status-pulse text-muted-foreground"
          >
            {environment.label}…
          </span>
        );
      })}
      <span className="ms-auto text-muted-foreground">
        {scanning.length === 1
          ? "1 device still scanning"
          : `${scanning.length} devices still scanning`}
      </span>
    </div>
  );
}

/**
 * Stand-in with the loaded page's shape. The blocks hold still (`shimmer={false}`)
 * rather than sweeping: this one stays up for a whole page load, and a loop that
 * never settles reads as a page that is stuck.
 * Blocks fill in exactly once when the last device answers.
 */
export function UsageSkeleton() {
  return (
    <>
      <section className="grid gap-6 lg:grid-cols-18rem-1fr">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <Skeleton shimmer={false} className="h-9 w-36" />
            <Skeleton shimmer={false} className="h-4 w-40" />
          </div>
          {PROVIDER_ORDER.map((provider) => (
            <div key={provider} className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-2">
                <Skeleton shimmer={false} className="mt-1.5 size-2 shrink-0 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton shimmer={false} className="h-3.5 w-20" />
                  <Skeleton shimmer={false} className="h-2.5 w-16" />
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Skeleton shimmer={false} className="h-3.5 w-14" />
                <Skeleton shimmer={false} className="h-2.5 w-24" />
              </div>
            </div>
          ))}
          <Skeleton shimmer={false} className="h-3 w-56" />
        </div>

        <div className="flex flex-col gap-3">
          <Skeleton shimmer={false} className="h-7 w-35 rounded-lg" />
          <div className="rounded-xl border border-border p-2">
            <Skeleton shimmer={false} tone="faint" className="h-48" />
            <Skeleton shimmer={false} className="mt-1 h-3 w-full" />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-foreground">Totals</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-1 md:grid-cols-5">
          {["Processed tokens", "Cached input", "Uncached input", "Output", "Cache savings"].map(
            (label) => (
              <div key={label} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Skeleton shimmer={false} className="h-6 w-16" />
              </div>
            ),
          )}
        </div>
      </section>

      <section className="rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton shimmer={false} className="h-4 w-20" />
          <Skeleton shimmer={false} className="h-6 w-35 rounded-lg" />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} shimmer={false} tone="faint" className="h-8" />
          ))}
        </div>
      </section>
    </>
  );
}
