import { formatDay } from "@everr/ui/lib/timestamp";
import { ChartEmptyState } from "@everr/ui/components/chart-helpers";
import { SeriesChart } from "@everr/ui/components/series-chart";
import { useMemo } from "react";
import type { RepoSuccessRatePoint } from "#app/data/repo-detail/schemas.ts";

interface RepoSuccessRateChartProps {
  data: RepoSuccessRatePoint[];
}

const AXES = {
  left: { format: (value: number) => `${value}%`, min: 0, max: 100 },
  right: { format: (value: number) => value.toLocaleString() },
};

export function RepoSuccessRateChart({ data }: RepoSuccessRateChartProps) {
  const chart = useMemo(
    () => ({
      labels: data.map((point) => formatDay(point.date, "never")),
      titles: data.map((point) => formatDay(point.date, "always")),
      series: [
        {
          id: "totalRuns",
          label: "Total Runs",
          color: "hsl(217, 91%, 60%)",
          kind: "bar" as const,
          rightAxis: true,
          values: data.map((point) => point.totalRuns),
        },
        {
          id: "successRate",
          label: "Success Rate",
          color: "hsl(142, 71%, 45%)",
          kind: "line" as const,
          values: data.map((point) => point.successRate),
        },
      ],
    }),
    [data],
  );

  if (data.length === 0) {
    return <ChartEmptyState message="No data available" />;
  }
  return <SeriesChart {...chart} axes={AXES} showLegend className="h-75 w-full" />;
}
