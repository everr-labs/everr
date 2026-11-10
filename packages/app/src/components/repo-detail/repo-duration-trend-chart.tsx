import { ChartEmptyState, formatChartDate } from "@everr/ui/components/chart-helpers";
import { SeriesChart } from "@everr/ui/components/series-chart";
import { formatDurationCompact } from "@everr/ui/lib/formatting";
import { useMemo } from "react";
import { seriesValueAxis } from "#app/components/dashboards/visualizations/echarts/axis.ts";
import { createValueFormatter } from "#app/components/dashboards/visualizations/value-format.ts";
import type { RepoDurationPoint } from "#app/data/repo-detail/schemas.ts";

interface RepoDurationTrendChartProps {
  data: RepoDurationPoint[];
}

const DURATION = createValueFormatter({ unit: "ms", scale: "duration" });

export function RepoDurationTrendChart({ data }: RepoDurationTrendChartProps) {
  const chart = useMemo(() => {
    const p50 = data.map((point) => point.p50Duration);
    const p95 = data.map((point) => point.p95Duration);
    // Ticks round in the displayed unit (e.g. 0.5 min), not in milliseconds.
    const max = Math.max(0, ...p50, ...p95);
    return {
      labels: data.map((point) => formatChartDate(point.date)),
      titles: data.map((point) => new Date(point.date).toLocaleDateString()),
      axes: {
        left: seriesValueAxis(DURATION, max, formatDurationCompact),
      },
      series: [
        {
          id: "p50Duration",
          label: "P50",
          color: "hsl(217, 91%, 60%)",
          kind: "line" as const,
          values: p50,
        },
        {
          id: "p95Duration",
          label: "P95",
          color: "hsl(0, 84%, 60%)",
          kind: "line" as const,
          values: p95,
        },
      ],
    };
  }, [data]);

  if (data.length === 0) {
    return <ChartEmptyState message="No data available" />;
  }
  return <SeriesChart {...chart} showLegend className="h-75 w-full" />;
}
