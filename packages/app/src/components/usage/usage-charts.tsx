import { useMemo } from "react";
import type {
  QueryResultRow,
  ResolvedTimeRange,
} from "@/components/dashboards/visualizations";
import { BarChartVisualization } from "@/components/dashboards/visualizations/bar-chart/bar-chart-visualization";
import { barChartSpec } from "@/components/dashboards/visualizations/bar-chart/spec";
import { timeSeriesChartSpec } from "@/components/dashboards/visualizations/time-series-chart/spec";
import { TimeSeriesChartVisualization } from "@/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization";
import { projectToPeriodEnd } from "@/data/usage/forecast";
import { usageCosts } from "@/data/usage/pricing";
import type {
  CurrentPeriodUsage,
  RangeUsage,
  UsageHistory,
} from "@/data/usage/schemas";

const ingestionSpec = timeSeriesChartSpec.parse({
  stacked: true,
  showLegend: true,
});

const costForecastSpec = timeSeriesChartSpec.parse({
  unit: "$",
  showLegend: true,
  lineWidth: 2,
});

const historySpec = barChartSpec.parse({
  stacking: "stacked",
  showLegend: true,
  unit: "$",
});

const noopTimeRangeChange = () => {};

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

export function IngestionChart({
  usage,
  onTimeRangeChange = noopTimeRangeChange,
}: {
  usage: RangeUsage;
  onTimeRangeChange?: (range: ResolvedTimeRange) => void;
}) {
  const data = useMemo<QueryResultRow[][]>(
    () => [
      usage.buckets.map((bucket) => ({
        ts: bucket.bucket,
        Logs: bucket.logs,
        Spans: bucket.spans,
        "Metric datapoints": bucket.metrics,
      })),
    ],
    [usage],
  );
  const timeRange = useMemo<ResolvedTimeRange>(
    () => ({ from: new Date(usage.from), to: new Date(usage.to) }),
    [usage],
  );

  return (
    <TimeSeriesChartVisualization
      spec={ingestionSpec}
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
    />
  );
}

export function CostForecastChart({ usage }: { usage: CurrentPeriodUsage }) {
  const data = useMemo<QueryResultRow[][]>(() => {
    let cumulative = 0;
    const actual = usage.daily.map((day) => {
      cumulative += usageCosts(day).total;
      return { ts: day.bucket, "Cost to date": roundCents(cumulative) };
    });
    const projected = usageCosts(projectToPeriodEnd(usage)).total;
    const forecast = [
      { ts: usage.now, Forecast: roundCents(cumulative) },
      { ts: usage.periodEnd, Forecast: roundCents(projected) },
    ];
    return [actual, forecast];
  }, [usage]);
  const timeRange = useMemo<ResolvedTimeRange>(
    () => ({
      from: new Date(usage.periodStart),
      to: new Date(usage.periodEnd),
    }),
    [usage],
  );

  return (
    <TimeSeriesChartVisualization
      spec={costForecastSpec}
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={noopTimeRangeChange}
    />
  );
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function MonthlyCostChart({ history }: { history: UsageHistory }) {
  const data = useMemo<QueryResultRow[][]>(
    () => [
      history.months.map((month) => {
        const costs = usageCosts(month);
        return {
          month: MONTH_LABEL.format(new Date(month.bucket)),
          Logs: roundCents(costs.logs),
          Spans: roundCents(costs.spans),
          "Metric datapoints": roundCents(costs.metrics),
        };
      }),
    ],
    [history],
  );
  const timeRange = useMemo<ResolvedTimeRange>(
    () => ({ from: new Date(0), to: new Date(0) }),
    [],
  );

  return (
    <BarChartVisualization
      spec={historySpec}
      data={data}
      timeRange={timeRange}
      onTimeRangeChange={noopTimeRangeChange}
    />
  );
}
