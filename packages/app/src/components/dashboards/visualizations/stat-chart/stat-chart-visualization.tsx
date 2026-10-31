import { cn } from "@everr/ui/lib/utils";
import { Hash } from "lucide-react";
import { useMemo } from "react";
import { queryLabel } from "../data-utils";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import type { StatChartSpec } from "./spec";
import {
  resolveStatSparklineColor,
  resolveStatTileColor,
  STAT_BACKGROUND_GRADIENT,
} from "./stat-colors";
import { computeStatTiles } from "./stat-series";
import { StatSparkline } from "./stat-sparkline";
import "./stat-chart.css";

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
  const formatter = createValueFormatter(spec.valueFormat);
  const {
    calculation,
    sparkline: showSparkline,
    colors,
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
    <div className="stat-chart flex h-full w-full flex-wrap items-stretch justify-center overflow-hidden">
      {tiles.map((tile) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const formatted = value === undefined ? undefined : formatter.parts(value);
        const color = resolveStatTileColor(tile, thresholds);
        const background = colorMode === "background" && color !== undefined;
        const sparklineColor = resolveStatSparklineColor(label, colors, color, background);
        return (
          <div
            key={`${tile.frame}-${tile.label}`}
            className={cn(
              "relative flex min-w-24 flex-1 flex-col overflow-hidden",
              multi && "border-r border-border/30 last:border-r-0",
            )}
            style={
              background && multi
                ? { backgroundColor: color, backgroundImage: STAT_BACKGROUND_GRADIENT }
                : undefined
            }
          >
            <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-4">
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
                {value === undefined ? noValue : formatted?.value}
                {formatted?.unit && (
                  <span
                    className={cn(
                      unitSize,
                      formatted.separator && "ml-1",
                      background ? "text-white/70" : "text-muted-foreground",
                    )}
                  >
                    {formatted.unit}
                  </span>
                )}
              </p>
            </div>
            {showSparkline && tile.points.length > 1 && (
              <div className="stat-chart-sparkline pointer-events-none absolute inset-x-0 bottom-0 h-1/3 max-h-24">
                <StatSparkline points={tile.points} color={sparklineColor} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
