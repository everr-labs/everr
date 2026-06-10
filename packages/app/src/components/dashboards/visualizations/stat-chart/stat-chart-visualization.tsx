import { ChartContainer } from "@everr/ui/components/chart";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart } from "recharts";
import type { VisualizationProps } from "../index";
import type { StatChartSpec } from "./spec";
import { formatStatValue, resolveThresholdColor } from "./stat-calculations";
import { computeStatTiles } from "./stat-series";

const SPARKLINE_COLOR = "hsl(217, 91%, 60%)";

export function StatChartVisualization({
  spec,
  data,
}: VisualizationProps<StatChartSpec>) {
  const { calculation, unit, sparkline: showSparkline, thresholds } = spec;

  const tiles = useMemo(
    () => (data ? computeStatTiles(data, calculation) : []),
    [data, calculation],
  );
  const renderable = tiles.filter((t) => t.value !== undefined);

  if (!data || renderable.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Hash className="size-8" />
        <p className="text-sm">
          {!data ? "Configure a query to see results" : "No numeric data"}
        </p>
      </div>
    );
  }

  const multi = renderable.length > 1;

  return (
    <div className="flex h-full flex-wrap items-stretch justify-center gap-4">
      {renderable.map((tile, i) => {
        const value = tile.value as number;
        const seriesMax = tile.values.length > 0 ? Math.max(...tile.values) : 0;
        const color = resolveThresholdColor(value, thresholds, seriesMax);
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: tile order is stable within a render
            key={i}
            className="flex min-w-24 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              {multi && (
                <p className="text-xs text-muted-foreground">{tile.label}</p>
              )}
              <p
                className="text-4xl font-semibold tabular-nums"
                style={color ? { color } : undefined}
              >
                {formatStatValue(value)}
                {unit && (
                  <span className="ml-1 text-2xl text-muted-foreground">
                    {unit}
                  </span>
                )}
              </p>
            </div>
            {showSparkline && tile.points.length > 1 && (
              <div className="h-1/3 max-h-24 w-full">
                <ChartContainer
                  config={{
                    value: { label: "value", color: color ?? SPARKLINE_COLOR },
                  }}
                  className="aspect-auto h-full w-full"
                >
                  <AreaChart
                    data={tile.points}
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
      })}
    </div>
  );
}
