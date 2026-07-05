import { ChartContainer } from "@everr/ui/components/chart";
import { cn } from "@everr/ui/lib/utils";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { Area, AreaChart, XAxis } from "recharts";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import type { StatChartSpec } from "./spec";
import { formatStatValue, resolveThresholdColor } from "./stat-calculations";
import { computeStatTiles } from "./stat-series";

/** Value text scales down as tiles crowd the panel. */
function valueSizeClass(tileCount: number): string {
  if (tileCount <= 2) return "text-4xl";
  if (tileCount <= 4) return "text-3xl";
  return "text-2xl";
}

function unitSizeClass(tileCount: number): string {
  if (tileCount <= 2) return "text-2xl";
  if (tileCount <= 4) return "text-xl";
  return "text-lg";
}

export function StatChartVisualization({ spec, data }: VisualizationProps<StatChartSpec>) {
  const {
    calculation,
    unit,
    decimals,
    sparkline: showSparkline,
    thresholds,
    colorMode,
    showLabel,
    noValue,
  } = spec;

  const tiles = useMemo(
    () => (data ? computeStatTiles(data, calculation) : []),
    [data, calculation],
  );
  const hasAnyValue = tiles.some((t) => t.value !== undefined);

  if (!data || !hasAnyValue) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Hash className="size-8" />
        <p className="text-sm">{!data ? "Configure a query to see results" : "No numeric data"}</p>
      </div>
    );
  }

  const multi = tiles.length > 1;
  const valueSize = valueSizeClass(tiles.length);
  const unitSize = unitSizeClass(tiles.length);

  return (
    <div className="flex h-full flex-wrap items-stretch justify-center gap-4">
      {tiles.map((tile) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const seriesMax = tile.points.length > 0 ? Math.max(...tile.points.map((p) => p.value)) : 0;
        const color =
          value !== undefined ? resolveThresholdColor(value, thresholds, seriesMax) : undefined;
        const background = colorMode === "background" && color !== undefined;
        const sparklineColor = background
          ? "rgba(255, 255, 255, 0.9)"
          : (color ?? SERIES_COLORS[0]);
        return (
          <div
            key={`${tile.frame}-${tile.label}`}
            className={cn("flex min-w-24 flex-1 flex-col", background && "rounded-md p-2")}
            style={background ? { backgroundColor: color } : undefined}
          >
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
              {(multi || showLabel) && (
                <p
                  className={cn("text-xs", background ? "text-white/80" : "text-muted-foreground")}
                >
                  {label}
                </p>
              )}
              <p
                className={cn(
                  valueSize,
                  "font-semibold tabular-nums",
                  background && "text-white",
                  value === undefined && !background && "text-muted-foreground",
                )}
                style={!background && color ? { color } : undefined}
              >
                {value === undefined ? noValue : formatStatValue(value, decimals)}
                {value !== undefined && unit && (
                  <span
                    className={cn(
                      unitSize,
                      "ml-1",
                      background ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {unit}
                  </span>
                )}
              </p>
            </div>
            {showSparkline && tile.points.length > 1 && (
              <div className="h-1/3 max-h-24 w-full">
                <ChartContainer config={{}} className="aspect-auto h-full w-full">
                  <AreaChart data={tile.points} margin={{ top: 2, left: 0, right: 0, bottom: 0 }}>
                    {/* Real time axis (hidden): without it recharts spaces
                        points by index and missing buckets compress the
                        timeline. */}
                    <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} hide />
                    <Area
                      dataKey="value"
                      type="monotone"
                      stroke={sparklineColor}
                      fill={sparklineColor}
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
