import { cn } from "@everr/ui/lib/utils";
import { Gauge } from "lucide-react";
import { useMemo } from "react";
import { queryLabel, SERIES_COLORS } from "../data-utils";
import type { VisualizationProps } from "../index";
import {
  formatStatValue,
  resolveThresholdColor,
} from "../stat-chart/stat-calculations";
import { computeStatTiles } from "../stat-chart/stat-series";
import {
  axisFraction,
  bandColors,
  type FillSegment,
  fillSegments,
  formatAxisValue,
  type ThresholdMark,
  thresholdMarks,
} from "./gauge-axis";
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

/** A mark that renders: the colorless steps are filtered out up front. */
type Tick = ThresholdMark & { color: string };

/** Everything both variants draw, prepared once per gauge. */
interface TileProps {
  label: React.ReactNode;
  value: number | undefined;
  valueText: string;
  unit: string;
  fraction: number;
  ticks: Tick[];
  showAxis: boolean;
  showThresholdLabels: boolean;
  minText: string;
  maxText: string;
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
  const fallbackColor = SERIES_COLORS[0] ?? "currentColor";
  const marks = useMemo(
    () => thresholdMarks(thresholds, min, max, unit),
    [thresholds, min, max, unit],
  );
  const ticks = useMemo(
    () => marks.filter((m): m is Tick => m.color !== undefined),
    [marks],
  );
  // The bands the marks cut the track into are the same for every gauge in the
  // panel, so they are resolved here rather than per tile.
  const colors = useMemo(
    () => bandColors(marks, thresholds, min, max, fallbackColor),
    [marks, thresholds, min, max, fallbackColor],
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

  const horizontal = variant === "horizontal";
  const multi = tiles.length > 1;
  const minText = formatAxisValue(min);
  const maxText = formatAxisValue(max);

  return (
    <div
      className={cn(
        "flex h-full flex-wrap justify-center",
        horizontal
          ? "content-center-safe gap-x-6 gap-y-4 overflow-y-auto px-1"
          : "items-stretch gap-4",
      )}
    >
      {tiles.map((tile) => {
        const value = tile.value;
        const name = tile.label || queryLabel(tile.frame);
        const fraction =
          value !== undefined ? axisFraction(value, min, max) : 0;
        const valueText =
          value === undefined ? noValue : formatStatValue(value, decimals);
        const label = (multi || showLabel) && (
          <p
            className={cn(
              "truncate text-xs text-muted-foreground",
              horizontal && "mb-1",
            )}
          >
            {name}
          </p>
        );
        const props: TileProps = {
          label,
          value,
          valueText,
          unit,
          fraction,
          ticks,
          showAxis,
          showThresholdLabels,
          minText,
          maxText,
        };
        const key = `${tile.frame}-${tile.label}`;
        const ariaLabel = `${name}: ${valueText}${unit ? ` ${unit}` : ""}`;

        return horizontal ? (
          <GaugeBar
            key={key}
            {...props}
            ariaLabel={ariaLabel}
            segments={fillSegments(fraction, marks, colors)}
          />
        ) : (
          <GaugeArc
            key={key}
            {...props}
            ariaLabel={ariaLabel}
            color={
              (value !== undefined
                ? resolveThresholdColor(value, thresholds, max)
                : undefined) ?? fallbackColor
            }
          />
        );
      })}
    </div>
  );
}

/** Flat bar filling left to right, with a marker at the current value. */
function GaugeBar({
  label,
  value,
  valueText,
  unit,
  fraction,
  ticks,
  showAxis,
  showThresholdLabels,
  minText,
  maxText,
  ariaLabel,
  segments,
}: TileProps & { ariaLabel: string; segments: FillSegment[] }) {
  return (
    <div className="min-w-40 flex-1" role="img" aria-label={ariaLabel}>
      {label}
      <p className="mb-2 leading-none">
        {/* Like the arc, the number stays neutral: the band color is carried
            by the fill segments, not the text. */}
        <span
          className={cn(
            "text-2xl font-semibold tabular-nums",
            value === undefined ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {valueText}
        </span>
        {value !== undefined && unit && (
          <span className="ml-1 text-xs text-muted-foreground">{unit}</span>
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
        {ticks.length > 0 && (
          <div className={cn("relative", showThresholdLabels ? "h-6" : "h-2")}>
            {ticks.map((tick) => (
              <div
                key={`${tick.fraction}-${tick.color}`}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${tick.fraction * 100}%` }}
              >
                <div
                  className="mx-auto h-1.5 w-px"
                  style={{ backgroundColor: tick.color }}
                />
                {showThresholdLabels && (
                  <p className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                    {tick.text}
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

/** Semicircular arc filling from the min end, with the value at its center. */
function GaugeArc({
  label,
  value,
  valueText,
  unit,
  fraction,
  ticks,
  showAxis,
  showThresholdLabels,
  minText,
  maxText,
  ariaLabel,
  color,
}: TileProps & { ariaLabel: string; color: string }) {
  return (
    <div className="flex min-w-28 flex-1 flex-col items-center">
      {label}
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
          {ticks.map((tick) => {
            const angle = 180 - tick.fraction * 180;
            const inner = polar(R - STROKE / 2 - 2, angle);
            const outer = polar(R + STROKE / 2 + 2, angle);
            const labelPos = polar(R + STROKE / 2 + 6, angle);
            return (
              <g key={`${tick.fraction}-${tick.color}`}>
                <line
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={tick.color}
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
                    {tick.text}
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
              value === undefined ? "fill-muted-foreground" : "fill-foreground",
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
}
