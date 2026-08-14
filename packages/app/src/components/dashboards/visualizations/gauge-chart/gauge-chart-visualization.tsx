import { cn } from "@everr/ui/lib/utils";
import { Gauge } from "lucide-react";
import { useMemo } from "react";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import {
  formatStatValue,
  resolveThresholdBand,
  type ThresholdsSpec,
} from "../stat-chart/stat-calculations";
import { computeStatTiles } from "../stat-chart/stat-series";
import type { GaugeChartSpec } from "./spec";

/**
 * 0..1 position of `value` along the gauge axis, measured from the `min` end.
 * Inverted bounds (`min > max`) are supported: the signed span flips the
 * direction so the bar fills toward the `max` end as the value approaches it.
 * Returns 0 only for a truly degenerate axis (`min === max`).
 */
function axisFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

interface ThresholdMark {
  fraction: number;
  /** Step value in axis units, for the tick label. */
  value: number;
}

interface FillSegment {
  from: number;
  to: number;
  color: string;
}

/**
 * Step positions projected onto the gauge axis, in axis units. Percent steps
 * resolve against the same reference `resolveThresholdBand` uses
 * (thresholds.max, falling back to the gauge max), so a mark always sits where
 * the band changes. Only steps strictly inside the axis span are kept — works
 * for inverted bounds too.
 */
function thresholdMarks(
  thresholds: ThresholdsSpec | undefined,
  min: number,
  max: number,
): ThresholdMark[] {
  if (!thresholds?.steps) return [];
  const ref = thresholds.max ?? max;
  return thresholds.steps
    .map((step) => ({
      value:
        thresholds.mode === "percent" ? (step.value / 100) * ref : step.value,
    }))
    .filter((t) => t.value > Math.min(min, max) && t.value < Math.max(min, max))
    .map((t) => ({ fraction: axisFraction(t.value, min, max), value: t.value }))
    .sort((a, b) => a.fraction - b.fraction);
}

/**
 * The filled part of the track, split at each threshold the value has crossed,
 * each piece painted with its band's color. Each segment resolves its color
 * from the axis value at its midpoint, so inverted bounds (`min > max`) paint
 * the bands on the correct side without any ascending-axis assumption.
 */
function fillSegments(
  fraction: number,
  marks: ThresholdMark[],
  thresholds: ThresholdsSpec | undefined,
  min: number,
  max: number,
  fallback: string,
): FillSegment[] {
  const bounds = [0, ...marks.map((m) => m.fraction), 1];
  const segments: FillSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = bounds[i] ?? 0;
    const to = Math.min(fraction, bounds[i + 1] ?? 1);
    if (to <= from) continue;
    const midValue = min + ((from + to) / 2) * (max - min);
    const color =
      resolveThresholdBand(midValue, thresholds, max).color ?? fallback;
    segments.push({ from, to, color });
  }
  return segments;
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
  const marks = useMemo(
    () => thresholdMarks(thresholds, min, max),
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
  const fallbackColor = SERIES_COLORS[0] ?? "currentColor";

  return (
    <div className="flex h-full flex-wrap content-center justify-center gap-x-6 gap-y-4 px-1">
      {tiles.map((tile) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const band =
          value !== undefined
            ? resolveThresholdBand(value, thresholds, max)
            : { color: undefined, name: undefined };
        const color = band.color ?? fallbackColor;
        const fraction =
          value !== undefined ? axisFraction(value, min, max) : 0;
        const segments =
          value !== undefined
            ? fillSegments(fraction, marks, thresholds, min, max, fallbackColor)
            : [];
        const valueText =
          value === undefined ? noValue : formatStatValue(value, decimals);
        return (
          <div
            key={`${tile.frame}-${tile.label}`}
            className="min-w-40 flex-1"
            role="img"
            aria-label={`${label}: ${valueText}${unit ? ` ${unit}` : ""}${
              band.name ? ` (${band.name})` : ""
            }`}
          >
            {(multi || showLabel) && (
              <p className="mb-1 truncate text-xs text-muted-foreground">
                {label}
              </p>
            )}
            <p className="mb-2 leading-none">
              <span
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  value === undefined && "text-muted-foreground",
                )}
                style={value !== undefined ? { color } : undefined}
              >
                {valueText}
              </span>
              {value !== undefined && unit && (
                <span className="ml-1 text-xs text-muted-foreground">
                  {unit}
                </span>
              )}
              {value !== undefined && band.name && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  ({band.name})
                </span>
              )}
            </p>
            <div className="relative pt-2">
              {/* Triangle marker pointing down at the value position. */}
              {value !== undefined && (
                <div
                  className="absolute top-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-foreground"
                  style={{ left: `${fraction * 100}%` }}
                />
              )}
              <div className="relative h-2.5 overflow-hidden rounded-sm bg-muted">
                {segments.map((s) => (
                  <div
                    key={s.from}
                    className="absolute inset-y-0"
                    style={{
                      left: `${s.from * 100}%`,
                      width: `${(s.to - s.from) * 100}%`,
                      backgroundColor: s.color,
                    }}
                  />
                ))}
              </div>
              {marks.length > 0 && (
                <div className="relative h-6">
                  {marks.map((mark) => (
                    <div
                      key={mark.fraction}
                      className="absolute top-0 -translate-x-1/2"
                      style={{ left: `${mark.fraction * 100}%` }}
                    >
                      <div className="mx-auto h-1.5 w-px bg-muted-foreground" />
                      <p className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                        {formatStatValue(mark.value, undefined)}
                        {unit}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
