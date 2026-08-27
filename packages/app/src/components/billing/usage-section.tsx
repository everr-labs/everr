import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Skeleton } from "@everr/ui/components/skeleton";
import {
  Activity,
  CalendarDays,
  FileText,
  Gauge,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import type { OrgUsage, OrgUsageSeriesPoint } from "@/data/usage";
import type { Tier } from "@/lib/retention";
import {
  calculateUsageOverage,
  resolveUsageLimits,
  USAGE_METERS,
  type UsageMeter,
} from "@/lib/usage-limits";
import { UsageChart } from "./usage-chart";
import {
  buildUsageChartRows,
  buildUsageTotals,
  formatUsageBytes,
  formatUsageCost,
  formatUsageItems,
  formatUsagePercent,
  formatUsagePeriod,
  type UsagePeriodBounds,
} from "./usage-model";

const SIGNAL_META: Record<UsageMeter, { label: string; icon: LucideIcon }> = {
  traces: { label: "Traces", icon: Activity },
  logs: { label: "Logs", icon: FileText },
  metrics: { label: "Metrics", icon: Gauge },
};

type UsageSectionProps = {
  tier: Tier;
  period: UsagePeriodBounds;
  totals?: OrgUsage[];
  series?: OrgUsageSeriesPoint[];
  totalsStatus?: UsageQueryStatus;
  seriesStatus?: UsageQueryStatus;
};

type UsageQueryStatus = "pending" | "error" | "success";

export function UsageSection({
  tier,
  period,
  totals = [],
  series = [],
  totalsStatus = "success",
  seriesStatus = "success",
}: UsageSectionProps) {
  const bothPending = totalsStatus === "pending" && seriesStatus === "pending";
  const bothFailed = totalsStatus === "error" && seriesStatus === "error";

  return (
    <section aria-labelledby="usage-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2
            id="usage-heading"
            className="text-sm font-semibold tracking-tight"
          >
            Usage
          </h2>
          <p className="text-muted-foreground text-xs">
            Uncompressed stored telemetry, measured separately per signal.
          </p>
        </div>
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CalendarDays className="size-3.5" aria-hidden />
          <span>{formatUsagePeriod(period)} (UTC)</span>
        </p>
      </div>

      {bothPending ? (
        <UsageLoading />
      ) : bothFailed ? (
        <UsageError
          title="Usage is temporarily unavailable"
          description="Your plan and billing controls are still available. Try this page again in a moment."
        />
      ) : (
        <>
          {totalsStatus === "pending" ? (
            <UsageTotalsLoading />
          ) : totalsStatus === "error" ? (
            <UsageError
              title="Usage summary is temporarily unavailable"
              description="Daily usage is still available below. Try this page again in a moment."
            />
          ) : (
            <UsageTotals tier={tier} totals={totals} />
          )}

          {seriesStatus === "pending" ? (
            <UsageSeriesLoading />
          ) : seriesStatus === "error" ? (
            <UsageError
              title="Daily usage is temporarily unavailable"
              description="Usage totals are still available above. Try this page again in a moment."
            />
          ) : (
            <UsageSeries period={period} series={series} />
          )}
        </>
      )}
    </section>
  );
}

function UsageLoading() {
  return (
    <div role="status" aria-label="Loading usage" className="space-y-3">
      <UsageTotalsLoading />
      <UsageSeriesLoading />
    </div>
  );
}

function UsageTotalsLoading() {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {USAGE_METERS.map((meter) => (
        <Skeleton key={meter} className="h-40 rounded-xl" />
      ))}
    </div>
  );
}

function UsageSeriesLoading() {
  return <Skeleton className="h-80 rounded-xl" />;
}

function UsageError({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card role="alert" className="border-destructive/30">
      <CardContent className="flex items-start gap-3 py-6">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div>
          <p className="font-medium text-sm">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function UsageTotals({
  tier,
  totals,
}: Required<Pick<UsageSectionProps, "tier" | "totals">>) {
  const totalsByMeter = buildUsageTotals(totals);
  const limits = resolveUsageLimits(tier);

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {USAGE_METERS.map((meter) => (
        <UsageSignalCard
          key={meter}
          meter={meter}
          bytes={totalsByMeter[meter].bytes}
          items={totalsByMeter[meter].items}
          limit={limits[meter]}
        />
      ))}
    </div>
  );
}

function UsageSeries({
  period,
  series,
}: Required<Pick<UsageSectionProps, "period" | "series">>) {
  const chartRows = buildUsageChartRows(series, period);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily usage</CardTitle>
        <CardDescription>
          Arrival-time volume in UTC, stacked by telemetry signal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <UsageChart rows={chartRows} />
      </CardContent>
    </Card>
  );
}

function UsageSignalCard({
  meter,
  bytes,
  items,
  limit,
}: {
  meter: UsageMeter;
  bytes: number;
  items: number;
  limit: ReturnType<typeof resolveUsageLimits>[UsageMeter];
}) {
  const { label, icon: Icon } = SIGNAL_META[meter];
  const utilization = (bytes / limit.includedBytes) * 100;
  const progress = Math.min(100, Math.max(0, utilization));
  const overage = calculateUsageOverage(bytes, limit);

  return (
    <Card data-testid={`usage-card-${meter}`}>
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon className="size-4 text-primary" aria-hidden />
            {label}
          </CardTitle>
          <span className="text-muted-foreground font-mono text-xs">
            {formatUsagePercent(utilization)}
          </span>
        </div>
        <div>
          <p className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
            {formatUsageBytes(bytes)}
          </p>
          <p className="text-muted-foreground text-xs">
            of {limit.includedGb} GB included
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          role="progressbar"
          aria-label={`${label} allowance used`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          className="bg-muted h-1.5 overflow-hidden rounded-full"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-muted-foreground text-xs">
          {formatUsageItems(items)} items ingested
        </p>
        {overage.costUsd !== null ? (
          overage.overageBytes > 0 ? (
            <p className="text-xs font-medium text-foreground">
              {formatUsageBytes(overage.overageBytes)} overage,{" "}
              {formatUsageCost(overage.costUsd)} estimated
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              No estimated overage
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}
