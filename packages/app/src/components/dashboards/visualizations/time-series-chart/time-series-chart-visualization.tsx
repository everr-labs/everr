import { LineChart as LineChartIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import UPlot from "uplot";
import { CursorTooltip } from "@/components/cursor-tooltip";
import {
  createTimeTickFormatter,
  generateTimeTicks,
  SERIES_COLORS,
} from "../data-utils";
import type { VisualizationProps } from "../index";
import { SeriesTooltipContent } from "../series-tooltip";
import type { TimeSeriesChartSpec } from "./spec";
import { buildChartModel, buildStackedValues } from "./time-series-data";
import { TimeSeriesLegend } from "./time-series-legend";
import { UplotChart, type UplotOptions } from "./uplot-chart";

const BRUSH_COLOR = SERIES_COLORS[0]!;
const MAX_X_TICKS = 6;
/** Ignore a brush that selects less than a second — it's a click, not a zoom. */
const MIN_ZOOM_MS = 1000;
const AXIS_FONT = "12px system-ui, sans-serif";

/**
 * `SERIES_COLORS` are literal `hsl(h, s%, l%)` strings; areas and the brush
 * want the same hue at partial opacity. Anything else passes through opaque.
 */
function withAlpha(color: string, alpha: number): string {
  return color.startsWith("hsl(")
    ? `hsla(${color.slice(4, -1)}, ${alpha})`
    : color;
}

const cssColorCache = new Map<string, string>();

/**
 * A theme token as a literal color. The chart draws to a canvas, which can't
 * resolve `var(--border)`, so the value is measured off a throwaway element.
 */
function cssColor(token: string, fallback: string): string {
  const cached = cssColorCache.get(token);
  if (cached !== undefined) return cached;
  if (typeof document === "undefined") return fallback;

  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color || fallback;
  probe.remove();

  cssColorCache.set(token, resolved);
  return resolved;
}

function pathBuilder(curveType: TimeSeriesChartSpec["curveType"]) {
  const paths = UPlot.paths!;
  switch (curveType) {
    // The step happens before the point (align -1) or after it (align 1).
    case "stepBefore":
      return paths.stepped!({ align: -1 });
    case "stepAfter":
      return paths.stepped!({ align: 1 });
    // `monotone` and `natural` reach here from panels written before smoothing
    // was deprecated; they draw straight, and the panel says so.
    default:
      return paths.linear!();
  }
}

/**
 * uPlot gives an axis a fixed width unless told otherwise, which clips wide
 * labels ("4,288MB" renders as "88MB"). Measure the widest one instead.
 */
function measureAxisSize(u: uPlot, values: string[] | null, gap: number) {
  const longest = (values ?? []).reduce(
    (acc, value) => (value.length > acc.length ? value : acc),
    "",
  );
  if (longest === "") return gap;
  u.ctx.save();
  u.ctx.font = AXIS_FONT;
  const width = u.ctx.measureText(longest).width;
  u.ctx.restore();
  return Math.ceil(width) + gap;
}

interface CursorState {
  idx: number;
  clientX: number;
  clientY: number;
}

export function TimeSeriesChartVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<TimeSeriesChartSpec>) {
  const { showLegend, connectNulls, lineWidth, unit, curveType, stacked } =
    spec;

  const [cursor, setCursor] = useState<CursorState | null>(null);
  const draggingRef = useRef(false);

  const onTimeRangeChangeRef = useRef(onTimeRangeChange);
  useEffect(() => {
    onTimeRangeChangeRef.current = onTimeRangeChange;
  }, [onTimeRangeChange]);

  const domain = useMemo<[number, number]>(
    () => [timeRange.from.getTime(), timeRange.to.getTime()],
    [timeRange],
  );

  const frame = useMemo(
    () => buildChartModel(data ?? [], domain),
    [data, domain],
  );

  const alignedData = useMemo<uPlot.AlignedData>(() => {
    const values = stacked
      ? buildStackedValues(frame.series)
      : frame.series.map((s) => s.values);
    return [frame.x, ...values] as uPlot.AlignedData;
  }, [frame, stacked]);

  const formatValue = useMemo(
    () => (value: number) => (unit ? `${value}${unit}` : String(value)),
    [unit],
  );

  const options = useMemo<UplotOptions>(() => {
    const axisColor = cssColor("--muted-foreground", "#8a8a8a");
    const gridColor = cssColor("--border", "#d4d4d8");
    const pointStroke = cssColor("--card", "#ffffff");
    const ticks = generateTimeTicks(domain, MAX_X_TICKS);
    const formatTick = createTimeTickFormatter(domain);
    let stopDragTracking: (() => void) | undefined;

    return {
      // The x axis is pinned to the panel's time range rather than to the
      // data: the leading bucket kept by the frame sits before `from`, and
      // letting it stretch the axis would misplace every other point.
      scales: {
        x: { time: false, range: () => domain },
        // Lines auto-range to the data (a flat series near 11ms is worth
        // seeing at 11ms, not squashed against a zero baseline), but a stacked
        // band is a quantity piled on zero — cutting the baseline off would
        // make the areas mean nothing.
        y: stacked
          ? {
              range: (_u, min, max) =>
                UPlot.rangeNum(Math.min(0, min), max, 0.1, true),
            }
          : {},
      },
      padding: [8, 12, 0, 0],
      legend: { show: false },
      cursor: {
        y: false,
        drag: { x: true, y: false, setScale: false, dist: 4 },
        points: { size: 8, width: 2, stroke: () => pointStroke },
        // Snap the crosshair onto the sample the tooltip is reporting — left
        // free, the two disagree by however far the nearest sample is, which
        // on a sparse panel is hours. A drag is exempt: uPlot draws the
        // selection from this same position, and a zoom has to be able to
        // start and end between samples.
        move: (u, left, top) => {
          if (draggingRef.current || left < 0) return [left, top];
          const ts = u.data[0][u.posToIdx(left)];
          return ts == null ? [left, top] : [u.valToPos(ts, "x"), top];
        },
      },
      axes: [
        {
          stroke: axisColor,
          font: AXIS_FONT,
          gap: 8,
          ticks: { show: false },
          border: { show: false },
          grid: { show: false },
          splits: () => ticks,
          values: (_u, splits) => splits.map(formatTick),
        },
        {
          stroke: axisColor,
          font: AXIS_FONT,
          gap: 8,
          ticks: { show: false },
          border: { show: false },
          grid: { stroke: gridColor, width: 1 },
          values: (_u, splits) => splits.map(formatValue),
          size: (u, values) => measureAxisSize(u, values, 12),
        },
      ],
      series: [
        {},
        ...frame.series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: lineWidth,
          spanGaps: connectNulls,
          paths: pathBuilder(curveType),
          points: { show: false },
          ...(stacked ? { fill: withAlpha(s.color, 0.4) } : {}),
        })),
      ],
      // Stacked series carry running totals, so each band is the strip between
      // its own line and the one below it. The bottom series has nothing below
      // it and fills to zero on its own.
      bands: stacked
        ? frame.series
            .slice(1)
            .map((_, i) => ({ series: [i + 2, i + 1] as [number, number] }))
        : undefined,
      hooks: {
        ready: [
          (u: uPlot) => {
            const down = () => {
              draggingRef.current = true;
            };
            const up = () => {
              draggingRef.current = false;
            };
            // Capture phase: uPlot computes the drag's start position from
            // `cursor.move` inside its own mousedown handler, so the flag has
            // to be set before that handler runs or the start snaps.
            u.over.addEventListener("mousedown", down, true);
            // On the document, not the plot: a drag often ends outside it.
            document.addEventListener("mouseup", up);
            stopDragTracking = () => {
              u.over.removeEventListener("mousedown", down, true);
              document.removeEventListener("mouseup", up);
            };
          },
        ],
        destroy: [
          () => {
            stopDragTracking?.();
            draggingRef.current = false;
          },
        ],
        setCursor: [
          (u: uPlot) => {
            const { idx, left, top } = u.cursor;
            if (idx == null || left == null || left < 0) {
              setCursor(null);
              return;
            }
            const rect = u.over.getBoundingClientRect();
            setCursor({
              idx,
              clientX: rect.left + left,
              clientY: rect.top + (top ?? 0),
            });
          },
        ],
        setSelect: [
          (u: uPlot) => {
            const { left, width } = u.select;
            if (width <= 0) return;
            const from = u.posToVal(left, "x");
            const to = u.posToVal(left + width, "x");
            // Clear before dispatching: the new time range rebuilds the chart,
            // and a leftover selection would be drawn over it.
            u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            if (to - from > MIN_ZOOM_MS) {
              onTimeRangeChangeRef.current({
                from: new Date(from),
                to: new Date(to),
              });
            }
          },
        ],
      },
    };
  }, [
    frame.series,
    domain,
    lineWidth,
    connectNulls,
    curveType,
    stacked,
    formatValue,
  ]);

  // Everything the options close over that is worth a rebuilt canvas. A new
  // frame with the same series line-up is a `setData` update, not a rebuild.
  const optionsKey = [
    frame.series.map((s) => `${s.key}:${s.label}`).join("|"),
    domain[0],
    domain[1],
    lineWidth,
    connectNulls,
    curveType,
    stacked,
    unit,
  ].join("/");

  // A frame with no series or no timestamps would render as an axis-only,
  // line-less chart — guard on both explicitly.
  if (!data || frame.series.length === 0 || frame.x.length === 0) {
    // Rows but no series means the query returned no numeric column to plot,
    // which is a different problem from a query that returned nothing.
    const hasRows = data?.some((rows) => rows?.length > 0) ?? false;
    const message = !data
      ? "Configure a query to see results"
      : hasRows && frame.series.length === 0
        ? "No numeric data to plot"
        : "No data in this time range";
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <LineChartIcon className="size-8" />
        <p className="text-sm">{message}</p>
      </div>
    );
  }

  const tooltipRows = cursor
    ? frame.series
        .map((s) => ({ series: s, value: s.values[cursor.idx] }))
        .filter((row) => row.value != null)
        .map(({ series, value }) => ({
          key: series.key,
          color: series.color,
          label: series.label,
          value: formatValue(value!),
        }))
    : [];

  const legendItems = frame.series.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
  }));

  return (
    <div
      className="flex h-full w-full select-none flex-col"
      style={
        {
          "--brush-fill": withAlpha(BRUSH_COLOR, 0.15),
          "--brush-stroke": withAlpha(BRUSH_COLOR, 0.3),
        } as React.CSSProperties
      }
    >
      <UplotChart
        options={options}
        optionsKey={optionsKey}
        data={alignedData}
        className="min-h-0 flex-1 [&_.u-cursor-x]:border-border [&_.u-cursor-x]:border-dashed [&_.u-select]:border [&_.u-select]:border-[var(--brush-stroke)] [&_.u-select]:bg-[var(--brush-fill)]"
      />
      {showLegend && <TimeSeriesLegend items={legendItems} />}
      {cursor && tooltipRows.length > 0 && (
        <CursorTooltip x={cursor.clientX} y={cursor.clientY}>
          <SeriesTooltipContent
            title={new Date(frame.x[cursor.idx]!).toLocaleString()}
            rows={tooltipRows}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
