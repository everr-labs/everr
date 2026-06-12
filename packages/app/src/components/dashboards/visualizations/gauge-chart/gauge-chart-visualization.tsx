import { cn } from "@everr/ui/lib/utils";
import { Gauge } from "lucide-react";
import { useMemo } from "react";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import {
  formatStatValue,
  resolveThresholdColor,
  type ThresholdsSpec,
} from "../stat-chart/stat-calculations";
import { computeStatTiles } from "../stat-chart/stat-series";
import type { GaugeChartSpec } from "./spec";

// Semicircle geometry in viewBox units. The round caps and the threshold
// ticks extend past the arc radius, hence the margins in the viewBox.
const VIEWBOX = "0 0 100 64";
const CX = 50;
const CY = 50;
const R = 38;
const STROKE = 9;

function polar(r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

/** Arc along the semicircle: 180° is the left end, 0° the right end. */
function arcPath(startAngle: number, endAngle: number): string {
  const s = polar(R, startAngle);
  const e = polar(R, endAngle);
  return `M ${s.x} ${s.y} A ${R} ${R} 0 0 1 ${e.x} ${e.y}`;
}

/**
 * 0..1 position of `value` along the gauge axis, measured from the `min` end.
 * Inverted bounds (`min > max`) are supported: the signed span flips the
 * direction so the arc fills toward the `max` end as the value approaches it.
 * Returns 0 only for a truly degenerate axis (`min === max`).
 */
function axisFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

interface ThresholdTick {
  fraction: number;
  color: string;
}

/**
 * Step positions projected onto the gauge axis. Percent steps resolve against
 * the same reference `resolveThresholdColor` uses (thresholds.max, falling
 * back to the gauge max), so a tick always sits where the color changes.
 */
function thresholdTicks(
  thresholds: ThresholdsSpec | undefined,
  min: number,
  max: number,
): ThresholdTick[] {
  if (!thresholds?.steps) return [];
  const ref = thresholds.max ?? max;
  return (
    thresholds.steps
      .map((step) => ({
        value:
          thresholds.mode === "percent" ? (step.value / 100) * ref : step.value,
        color: step.color,
      }))
      .filter(
        (t): t is { value: number; color: string } => t.color !== undefined,
      )
      // Keep ticks strictly inside the axis span — works for inverted bounds too.
      .filter(
        (t) => t.value > Math.min(min, max) && t.value < Math.max(min, max),
      )
      .map((t) => ({
        fraction: axisFraction(t.value, min, max),
        color: t.color,
      }))
  );
}

export function GaugeChartVisualization({
  spec,
  data,
}: VisualizationProps<GaugeChartSpec>) {
  const {
    calculation,
    unit,
    decimals,
    min,
    max,
    thresholds,
    showLabel,
    noValue,
  } = spec;

  const tiles = useMemo(
    () => (data ? computeStatTiles(data, calculation) : []),
    [data, calculation],
  );
  const hasAnyValue = tiles.some((t) => t.value !== undefined);
  const ticks = useMemo(
    () => thresholdTicks(thresholds, min, max),
    [thresholds, min, max],
  );

  if (!data || !hasAnyValue) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <Gauge className="size-8" />
        <p className="text-sm">
          {!data ? "Configure a query to see results" : "No numeric data"}
        </p>
      </div>
    );
  }

  const multi = tiles.length > 1;

  return (
    <div className="flex h-full flex-wrap items-stretch justify-center gap-4">
      {tiles.map((tile) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const color =
          (value !== undefined
            ? resolveThresholdColor(value, thresholds, max)
            : undefined) ??
          SERIES_COLORS[0] ??
          "currentColor";
        const fraction =
          value !== undefined ? axisFraction(value, min, max) : 0;
        const valueText =
          value === undefined ? noValue : formatStatValue(value, decimals);
        return (
          <div
            key={`${tile.frame}-${tile.label}`}
            className="flex min-w-28 flex-1 flex-col items-center"
          >
            {(multi || showLabel) && (
              <p className="text-xs text-muted-foreground">{label}</p>
            )}
            {/* The SVG is absolutely positioned: inside a wrapped flex line a
                percentage height can't resolve and the SVG would fall back to
                width-driven sizing and overflow the panel. */}
            <div className="relative min-h-0 w-full flex-1">
              <svg
                viewBox={VIEWBOX}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label={`${label}: ${valueText}${unit ? ` ${unit}` : ""}`}
              >
                <path
                  d={arcPath(180, 0)}
                  className="stroke-muted"
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  fill="none"
                />
                {fraction > 0 && (
                  <path
                    d={arcPath(180, 180 - fraction * 180)}
                    stroke={color}
                    strokeWidth={STROKE}
                    strokeLinecap="round"
                    fill="none"
                  />
                )}
                {ticks.map((tick) => {
                  const angle = 180 - tick.fraction * 180;
                  const inner = polar(R - STROKE / 2 - 2, angle);
                  const outer = polar(R + STROKE / 2 + 2, angle);
                  return (
                    <line
                      key={`${tick.fraction}-${tick.color}`}
                      x1={inner.x}
                      y1={inner.y}
                      x2={outer.x}
                      y2={outer.y}
                      stroke={tick.color}
                      strokeWidth={1.25}
                    />
                  );
                })}
                <text
                  x={CX}
                  y={46}
                  textAnchor="middle"
                  fontSize={13}
                  className={cn(
                    "font-semibold tabular-nums",
                    value === undefined
                      ? "fill-muted-foreground"
                      : "fill-foreground",
                  )}
                >
                  {valueText}
                  {value !== undefined && unit && (
                    <tspan
                      dx={1.5}
                      fontSize={7}
                      className="fill-muted-foreground font-normal"
                    >
                      {unit}
                    </tspan>
                  )}
                </text>
                <text
                  x={CX - R}
                  y={62}
                  textAnchor="middle"
                  fontSize={5.5}
                  className="fill-muted-foreground tabular-nums"
                >
                  {formatStatValue(min, undefined)}
                </text>
                <text
                  x={CX + R}
                  y={62}
                  textAnchor="middle"
                  fontSize={5.5}
                  className="fill-muted-foreground tabular-nums"
                >
                  {formatStatValue(max, undefined)}
                </text>
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
