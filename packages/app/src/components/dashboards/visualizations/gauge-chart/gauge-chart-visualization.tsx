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
 * direction so the gauge fills toward the `max` end as the value approaches
 * it. Returns 0 only for a truly degenerate axis (`min === max`).
 */
function axisFraction(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

interface ThresholdMark {
  fraction: number;
  /** Step value in axis units, for the tick label. */
  value: number;
  /** Ticks only render for steps that declare a color. */
  color?: string;
}

interface FillSegment {
  from: number;
  to: number;
  color: string;
}

/**
 * Step positions projected onto the gauge axis. Percent steps resolve against
 * the same reference `resolveThresholdColor` uses (thresholds.max, falling
 * back to the gauge max), so a mark always sits where the color changes.
 * Only steps strictly inside the axis span are kept — works for inverted
 * bounds too.
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
      color: step.color,
    }))
    .filter((t) => t.value > Math.min(min, max) && t.value < Math.max(min, max))
    .map((t) => ({
      fraction: axisFraction(t.value, min, max),
      value: t.value,
      color: t.color,
    }))
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
    const color = resolveThresholdColor(midValue, thresholds, max) ?? fallback;
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
    variant,
    showAxis,
    showThresholdLabels,
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
  const minText = formatStatValue(min, undefined);
  const maxText = formatStatValue(max, undefined);

  return (
    <div
      className={cn(
        variant === "horizontal" &&
          "flex h-full flex-wrap content-center-safe justify-center gap-x-6 gap-y-4 overflow-y-auto px-1",
        (variant === "arc" || variant === undefined) &&
          "flex h-full flex-wrap items-stretch justify-center gap-4",
      )}
    >
      {tiles.map((tile) => {
        const value = tile.value;
        const label = tile.label || queryLabel(tile.frame);
        const color =
          (value !== undefined
            ? resolveThresholdColor(value, thresholds, max)
            : undefined) ?? fallbackColor;
        const fraction =
          value !== undefined ? axisFraction(value, min, max) : 0;
        const valueText =
          value === undefined ? noValue : formatStatValue(value, decimals);
        const ariaLabel = `${label}: ${valueText}${unit ? ` ${unit}` : ""}`;
        const key = `${tile.frame}-${tile.label}`;
        const labelEl = (multi || showLabel) && (
          <p className="truncate text-xs text-muted-foreground">{label}</p>
        );

        if (variant === "horizontal") {
          const segments =
            value !== undefined
              ? fillSegments(
                  fraction,
                  marks,
                  thresholds,
                  min,
                  max,
                  fallbackColor,
                )
              : [];
          return (
            <div
              key={key}
              className="min-w-40 flex-1"
              role="img"
              aria-label={ariaLabel}
            >
              {labelEl && <div className="mb-1">{labelEl}</div>}
              <p className="mb-2 leading-none">
                {/* Like the arc, the number stays neutral: the band color is
                    carried by the fill segments, not the text. */}
                <span
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    value === undefined
                      ? "text-muted-foreground"
                      : "text-foreground",
                  )}
                >
                  {valueText}
                </span>
                {value !== undefined && unit && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {unit}
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
                {marks.some((m) => m.color) && (
                  <div
                    className={cn(
                      "relative",
                      showThresholdLabels ? "h-6" : "h-2",
                    )}
                  >
                    {marks
                      .filter((m) => m.color !== undefined)
                      .map((mark) => (
                        <div
                          key={`${mark.fraction}-${mark.color}`}
                          className="absolute top-0 -translate-x-1/2"
                          style={{ left: `${mark.fraction * 100}%` }}
                        >
                          <div
                            className="mx-auto h-1.5 w-px"
                            style={{ backgroundColor: mark.color }}
                          />
                          {showThresholdLabels && (
                            <p className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                              {formatStatValue(mark.value, undefined)}
                              {unit}
                            </p>
                          )}
                        </div>
                      ))}
                  </div>
                )}
                {showAxis && (
                  <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
                    <span>{minText}</span>
                    <span>{maxText}</span>
                  </div>
                )}
              </div>
            </div>
          );
        }

        return (
          <div key={key} className="flex min-w-28 flex-1 flex-col items-center">
            {labelEl}
            {/* The SVG is absolutely positioned: inside a wrapped flex line a
                percentage height can't resolve and the SVG would fall back to
                width-driven sizing and overflow the panel. */}
            <div className="relative min-h-0 w-full flex-1">
              <svg
                viewBox={VIEWBOX}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label={ariaLabel}
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
                {marks
                  .filter((m) => m.color !== undefined)
                  .map((mark) => {
                    const angle = 180 - mark.fraction * 180;
                    const inner = polar(R - STROKE / 2 - 2, angle);
                    const outer = polar(R + STROKE / 2 + 2, angle);
                    const labelPos = polar(R + STROKE / 2 + 6, angle);
                    return (
                      <g key={`${mark.fraction}-${mark.color}`}>
                        <line
                          x1={inner.x}
                          y1={inner.y}
                          x2={outer.x}
                          y2={outer.y}
                          stroke={mark.color}
                          strokeWidth={1.25}
                        />
                        {showThresholdLabels && (
                          <text
                            x={labelPos.x}
                            y={labelPos.y}
                            textAnchor="middle"
                            fontSize={5}
                            className="fill-muted-foreground tabular-nums"
                          >
                            {formatStatValue(mark.value, undefined)}
                            {unit}
                          </text>
                        )}
                      </g>
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
                {showAxis && (
                  <>
                    <text
                      x={CX - R}
                      y={62}
                      textAnchor="middle"
                      fontSize={5.5}
                      className="fill-muted-foreground tabular-nums"
                    >
                      {minText}
                    </text>
                    <text
                      x={CX + R}
                      y={62}
                      textAnchor="middle"
                      fontSize={5.5}
                      className="fill-muted-foreground tabular-nums"
                    >
                      {maxText}
                    </text>
                  </>
                )}
              </svg>
            </div>
          </div>
        );
      })}
    </div>
  );
}
