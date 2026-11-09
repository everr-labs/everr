import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import { type ChartSeries, SeriesChart } from "@everr/ui/components/series-chart";
import { useMemo } from "react";
import {
  BREAKDOWN_OTHER_KEY,
  type CostMetric,
  type CostOverTimeBreakdown,
} from "#app/data/cost-analysis/schemas.ts";
import { formatCost } from "#app/lib/runner-pricing.ts";
import { formatBucket } from "./format-bucket";

export type ActionsUsageDimension = "repo" | "runner";

interface ActionsUsageChartProps {
  data: CostOverTimeBreakdown;
  metric: CostMetric;
}

const SERIES_COLORS = [
  "hsl(217, 91%, 60%)",
  "hsl(263, 70%, 50%)",
  "hsl(25, 95%, 53%)",
  "hsl(142, 71%, 45%)",
  "hsl(340, 75%, 55%)",
  "hsl(190, 80%, 45%)",
];

const OTHER_COLOR = "hsl(0, 0%, 55%)";

function hasAnyValue(data: CostOverTimeBreakdown, metric: CostMetric): boolean {
  const field = metric === "spend" ? "cost" : "minutes";
  return data.points.some((point) => Object.values(point[field]).some((value) => value > 0));
}

export function ActionsUsageChart({ data, metric }: ActionsUsageChartProps) {
  const chart = useMemo(() => {
    const field = metric === "spend" ? "cost" : "minutes";
    const keys = data.hasOther ? [...data.topKeys, BREAKDOWN_OTHER_KEY] : data.topKeys;
    return {
      labels: data.points.map((point) => formatBucket(point.date, data.granularity, "axis")),
      titles: data.points.map((point) => formatBucket(point.date, data.granularity, "tooltip")),
      series: keys.map((key, index): ChartSeries => ({
        id: key,
        label: key === BREAKDOWN_OTHER_KEY ? "Other" : key,
        color:
          key === BREAKDOWN_OTHER_KEY ? OTHER_COLOR : SERIES_COLORS[index % SERIES_COLORS.length],
        kind: "bar",
        stack: "usage",
        values: data.points.map((point) => point[field][key] ?? 0),
      })),
      axes: {
        left: {
          format: (value: number) =>
            metric === "spend" ? formatCost(value) : Math.round(value).toLocaleString(),
        },
      },
    };
  }, [data, metric]);

  if (!hasAnyValue(data, metric)) {
    return <ChartEmptyState message="No usage data available" />;
  }
  return <SeriesChart {...chart} showLegend className="h-[320px] w-full" />;
}
