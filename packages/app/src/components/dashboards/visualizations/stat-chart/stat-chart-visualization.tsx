import { cn } from "@everr/ui/lib/utils";
import { Hash } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { queryLabel } from "../data-utils";
import type { VisualizationProps } from "../index";
import { createValueFormatter } from "../value-format";
import type { StatChartSpec } from "./spec";
import {
  resolveStatBackgroundAppearance,
  resolveStatSparklineColor,
  resolveStatTileColor,
} from "./stat-colors";
import { statColumns } from "./stat-layout";
import { computeStatTiles } from "./stat-series";
import { StatSparkline } from "./stat-sparkline";
import "./stat-chart.css";
import { PanelEmptyState } from "../panel-empty-state";

/**
 * Largest value text size, scaled down as tiles crowd the panel. The actual
 * size also shrinks with the tile width.
 */
function maxValueSize(tileCount: number): string {
  if (tileCount <= 2) return "var(--text-4xl)";
  if (tileCount <= 4) return "var(--text-3xl)";
  return "var(--text-2xl)";
}

function endsRow(index: number, columns: number, count: number): boolean {
  return index === count - 1 || (index + 1) % columns === 0;
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
  const [width, setWidth] = useState(0);
  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  if (!data || !hasAnyValue) {
    return <PanelEmptyState icon={Hash} data={data} unusable="The result has no numeric values." />;
  }

  const multi = tiles.length > 1;
  const valueSize = maxValueSize(tiles.length);
  const columns = statColumns(tiles.length, width);

  return (
    <div
      ref={measureRef}
      className="stat-chart flex h-full w-full flex-wrap items-stretch justify-center overflow-hidden"
    >
      {tiles.map((tile, index) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const formatted = value === undefined ? undefined : formatter.parts(value);
        const color = resolveStatTileColor(tile, thresholds);
        const background = colorMode === "background" && color !== undefined;
        const appearance = background ? resolveStatBackgroundAppearance(color) : undefined;
        const sparklineColor = resolveStatSparklineColor(
          label,
          colors,
          color,
          background,
          appearance?.foreground,
        );
        return (
          <div
            key={`${tile.frame}-${tile.label}`}
            className={cn(
              "stat-chart-tile relative flex flex-none flex-col overflow-hidden border-border/30",
              multi && !endsRow(index, columns, tiles.length) && "border-r",
              index >= columns && "border-t",
            )}
            style={{
              width: `${100 / columns}%`,
              ...(background && appearance
                ? {
                    color: appearance.foreground,
                    ...(multi
                      ? { backgroundColor: color, backgroundImage: appearance.gradient }
                      : {}),
                  }
                : {}),
            }}
          >
            <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-4">
              {(multi || showLabel) && (
                <p className={cn("text-xs", !background && "text-muted-foreground")}>{label}</p>
              )}
              <p
                className={cn(
                  "stat-chart-value font-semibold whitespace-nowrap tabular-nums",
                  value === undefined && !background && "text-muted-foreground",
                )}
                style={{
                  // Shrink with the tile so narrow tiles (e.g. on mobile) don't clip the value.
                  fontSize: `min(${valueSize}, 16cqi)`,
                  ...(!background && color ? { color } : {}),
                }}
              >
                {formatted === undefined ? noValue : formatted.value}
                {formatted?.unit && (
                  <span
                    className={cn(
                      "text-[0.67em]",
                      formatted.separator && "ml-1",
                      !background && "text-muted-foreground",
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
