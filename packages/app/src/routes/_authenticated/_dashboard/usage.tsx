import { Card, CardContent } from "@everr/ui/components/card";
import { createFileRoute } from "@tanstack/react-router";
import { DollarSign, Gauge, ScrollText, TrendingUp } from "lucide-react";
import { useCallback } from "react";
import type { ResolvedTimeRange } from "@/components/dashboards/visualizations";
import { DataPanel } from "@/components/data-panel";
import { TimeRangePanel } from "@/components/time-range-panel";
import { UsageBreakdownTable } from "@/components/usage/usage-breakdown-table";
import {
  CostForecastChart,
  IngestionChart,
  MonthlyCostChart,
} from "@/components/usage/usage-charts";
import { ensureOrgBillingAdmin, NotBillingAdminError } from "@/data/billing";
import { projectToPeriodEnd } from "@/data/usage/forecast";
import {
  usageCurrentPeriodOptions,
  usageForRangeOptions,
  usageHistoryOptions,
} from "@/data/usage/options";
import { formatCount, formatUsd, usageCosts } from "@/data/usage/pricing";
import { useTimeRange } from "@/hooks/use-time-range";
import {
  applyRouteTimeDefaults,
  ResolvedTimeRangeSearchSchema,
  type RouteTimeDefaults,
  TimeRangeSearchSchema,
} from "@/lib/time-range";

/** Month to date — the current billing period (calendar month). */
const USAGE_TIME_DEFAULTS: RouteTimeDefaults = { from: "now/M", to: "now" };

export const Route = createFileRoute("/_authenticated/_dashboard/usage")({
  staticData: { breadcrumb: "Usage" },
  head: () => ({
    meta: [{ title: "Everr - Usage" }],
  }),
  beforeLoad: async () => {
    await ensureOrgBillingAdmin();
  },
  errorComponent: ({ error }) => {
    if (
      error instanceof NotBillingAdminError ||
      error.name === "NotBillingAdminError"
    ) {
      return <NotAdminMessage />;
    }
    throw error;
  },
  validateSearch: TimeRangeSearchSchema,
  loaderDeps: ({ search }) => {
    const { from, to } = ResolvedTimeRangeSearchSchema.parse(
      applyRouteTimeDefaults(search, USAGE_TIME_DEFAULTS),
    );
    return { timeRange: { from, to } };
  },
  loader: async ({ context: { queryClient }, deps: { timeRange } }) => {
    await Promise.all([
      queryClient.prefetchQuery(usageForRangeOptions({ timeRange })),
      queryClient.prefetchQuery(usageCurrentPeriodOptions()),
      queryClient.prefetchQuery(usageHistoryOptions()),
    ]);
    return { timeDefaults: USAGE_TIME_DEFAULTS };
  },
  component: UsagePage,
});

function NotAdminMessage() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-muted-foreground text-sm">
            Only organization admins can view usage and billing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function UsagePage() {
  const { setTimeRange } = useTimeRange();
  const handleBrush = useCallback(
    (range: ResolvedTimeRange) =>
      setTimeRange({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      }),
    [setTimeRange],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Usage</h1>
        <p className="text-muted-foreground">
          Ingested telemetry and estimated spend. Billing periods are calendar
          months.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <TimeRangePanel
          title="Cost"
          titleHint="Estimated cost of telemetry ingested in the selected time range."
          queries={[usageForRangeOptions]}
          variant="stat"
          icon={DollarSign}
        >
          {(usage) => formatUsd(usageCosts(usage.totals).total)}
        </TimeRangePanel>

        <DataPanel
          title="Forecasted cost"
          titleHint="Linear projection of month-to-date usage to the end of the current billing period."
          queries={[usageCurrentPeriodOptions()]}
          variant="stat"
          icon={TrendingUp}
        >
          {(usage) => formatUsd(usageCosts(projectToPeriodEnd(usage)).total)}
        </DataPanel>

        <TimeRangePanel
          title="Logs + spans"
          titleHint="Log records and spans ingested in the selected time range."
          queries={[usageForRangeOptions]}
          variant="stat"
          icon={ScrollText}
        >
          {(usage) => formatCount(usage.totals.logs + usage.totals.spans)}
        </TimeRangePanel>

        <TimeRangePanel
          title="Metric datapoints"
          titleHint="Metric datapoints ingested in the selected time range, across all metric types."
          queries={[usageForRangeOptions]}
          variant="stat"
          icon={Gauge}
        >
          {(usage) => formatCount(usage.totals.metrics)}
        </TimeRangePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TimeRangePanel
          title="Ingestion"
          description="Ingested items in the selected time range"
          queries={[usageForRangeOptions]}
        >
          {(usage) => (
            <div className="h-[300px]">
              <IngestionChart usage={usage} onTimeRangeChange={handleBrush} />
            </div>
          )}
        </TimeRangePanel>

        <DataPanel
          title="Cost forecast"
          description="Cumulative cost this billing period, projected to period end"
          queries={[usageCurrentPeriodOptions()]}
        >
          {(usage) => (
            <div className="h-[300px]">
              <CostForecastChart usage={usage} />
            </div>
          )}
        </DataPanel>
      </div>

      <DataPanel
        title="Monthly cost history"
        description="Estimated cost per billing period at current prices (history is limited by data retention)"
        queries={[usageHistoryOptions()]}
      >
        {(history) => (
          <div className="h-[300px]">
            <MonthlyCostChart history={history} />
          </div>
        )}
      </DataPanel>

      <DataPanel
        title="Breakdown"
        description="Current billing period usage and forecast per signal"
        queries={[usageCurrentPeriodOptions()]}
        inset="flush-content"
      >
        {(usage) => <UsageBreakdownTable usage={usage} />}
      </DataPanel>
    </div>
  );
}
