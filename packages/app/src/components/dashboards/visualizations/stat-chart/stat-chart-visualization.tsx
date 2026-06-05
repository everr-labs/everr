import { ChartContainer } from "@everr/ui/components/chart";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart } from "recharts";
import { detectTimeKey, getValueKeys, toTimestamp } from "../data-utils";
import type { QueryResultRow, VisualizationProps } from "../index";
import {
  calculate,
  formatStatValue,
  isCalculationType,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "./stat-calculations";

const SPARKLINE_COLOR = "hsl(217, 91%, 60%)";

interface SeriesPoint {
  ts: number;
  value: number;
}

function extractSeries(data: QueryResultRow[]): {
  values: number[];
  points: SeriesPoint[];
} {
  const first = data[0];
  if (!first) return { values: [], points: [] };

  const timeKey = detectTimeKey(data);
  const valueKey = getValueKeys(first, timeKey ?? "")[0];
  if (!valueKey) return { values: [], points: [] };

  if (!timeKey) {
    const values = data
      .map((row) => row[valueKey])
      .filter((v): v is number => typeof v === "number");
    return { values, points: [] };
  }

  const points = data
    .filter((row) => typeof row[valueKey] === "number")
    .map((row) => ({
      ts: toTimestamp(row[timeKey]),
      value: row[valueKey] as number,
    }))
    .sort((a, b) => a.ts - b.ts);

  return { values: points.map((p) => p.value), points };
}

export function StatChartVisualization({ plugin, data }: VisualizationProps) {
  const spec = plugin.spec;
  const calculation = isCalculationType(spec.calculation)
    ? spec.calculation
    : "last";
  const unit = typeof spec.unit === "string" ? spec.unit : "";
  const showSparkline = spec.sparkline === true;
  const thresholds = (spec.thresholds ?? undefined) as
    | ThresholdsSpec
    | undefined;

  const { values, points } = useMemo(
    () => (data ? extractSeries(data) : { values: [], points: [] }),
    [data],
  );
  const value = useMemo(
    () => calculate(values, calculation),
    [values, calculation],
  );

  if (!data || value === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Hash className="size-8" />
        <p className="text-sm">
          {!data ? "Configure a query to see results" : "No numeric data"}
        </p>
      </div>
    );
  }

  const seriesMax = values.length > 0 ? Math.max(...values) : 0;
  const color = resolveThresholdColor(value, thresholds, seriesMax);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p
          className="text-4xl font-semibold tabular-nums"
          style={color ? { color } : undefined}
        >
          {formatStatValue(value)}
          {unit && (
            <span className="ml-1 text-2xl text-muted-foreground">{unit}</span>
          )}
        </p>
      </div>
      {showSparkline && points.length > 1 && (
        <div className="h-1/3 max-h-24 w-full">
          <ChartContainer
            config={{
              value: { label: "value", color: color ?? SPARKLINE_COLOR },
            }}
            className="aspect-auto h-full w-full"
          >
            <AreaChart
              data={points}
              margin={{ top: 2, left: 0, right: 0, bottom: 0 }}
            >
              <Area
                dataKey="value"
                type="monotone"
                stroke="var(--color-value)"
                fill="var(--color-value)"
                fillOpacity={0.2}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </div>
      )}
    </div>
  );
}
