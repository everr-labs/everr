import { CursorTooltip } from "@everr/ui/components/cursor-tooltip";
import { SeriesTooltipContent } from "@everr/ui/components/series-tooltip";
import { readableForeground } from "@everr/ui/lib/contrast";
import type { BarSeriesOption } from "echarts/charts";
import { BarChart } from "echarts/charts";
import type { GridComponentOption } from "echarts/components";
import type { ComposeOption } from "echarts/core";
import * as echarts from "echarts/core";
import { LabelLayout } from "echarts/features";
import { BarChart3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bucketIndexAt } from "../data-utils";
import {
  AXIS_LABEL_MARGIN,
  axisLabelsWidth,
  createTextMeasurer,
  niceValueAxis,
  plainAxisOption,
  timeLabelFormatter,
  timeTicks,
  VALUE_AXIS_EDGE_INSET,
  VALUE_LABEL_OVERHANG,
  valueAxisOption,
} from "../echarts/axis";
import {
  type GridInsets,
  getPlotRect,
  gridOption,
  plotWithin,
  ratioWithin,
} from "../echarts/plot-rect";
import {
  SeriesLegend,
  seriesTooltipRows,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import type { VisualizationProps } from "../index";
import { Brush } from "../time-track";
import { createValueFormatter } from "../value-format";
import { buildBarChartModel, X_KEY } from "./bar-chart-data";
import type { BarChartSpec } from "./spec";
import { PanelEmptyState } from "../panel-empty-state";
import { CursorLine } from "@everr/ui/components/cursor-line";
import { usePointTimeCursor, useTimeCursor } from "../shared-time-cursor";

echarts.use([BarChart, LabelLayout]);

type ChartOption = ComposeOption<BarSeriesOption | GridComponentOption>;

const MAX_CATEGORY_TICKS = 8;
const VALUE_LABEL_FONT_SIZE = 10;
const PLOT_EDGE_INSET = 12;
/** Narrowest the category axis gets on horizontal bars before labels truncate. */
const MIN_CATEGORY_AXIS_WIDTH = 90;
/** `percent` stacking draws shares of 1, labelled as percentages. */
const SHARE_FORMAT = createValueFormatter({ unit: "1", scale: "none", display: "percent" });

// Middle ellipsis: keeps both the head and tail of a label. Path-like
// categories (e.g. "/[locale]/company/[companyUID]/people") share a long
// common prefix and differ at the end, so plain end-truncation would collapse
// them all to the same string; keeping both ends preserves what distinguishes
// them.
function truncateMiddle(text: string, maxChars: number): string {
  if (maxChars < 1) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  const keep = maxChars - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return tail > 0
    ? `${text.slice(0, head)}…${text.slice(text.length - tail)}`
    : `${text.slice(0, head)}…`;
}

/** The longest middle-truncation of `text` that fits `maxPx`. */
function fitMiddle(text: string, maxPx: number, measure: (text: string) => number): string {
  if (measure(text) <= maxPx) return text;
  let lo = 1;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(truncateMiddle(text, mid)) <= maxPx) lo = mid;
    else hi = mid - 1;
  }
  return truncateMiddle(text, lo);
}

/** Each bar as a share of its category's total magnitude, for `percent`. */
function toShares(rows: Array<Record<string, unknown>>, ids: string[]) {
  return rows.map((row) => {
    let total = 0;
    for (const id of ids) {
      const value = row[id];
      if (typeof value === "number") total += Math.abs(value);
    }
    const shares: Record<string, number | null> = {};
    for (const id of ids) {
      const value = row[id];
      shares[id] = typeof value === "number" && total > 0 ? value / total : null;
    }
    return shares;
  });
}

/**
 * The shared cursor through the middle of the bar for its bucket. It reads the
 * cursor itself, so a move redraws the line and not the chart.
 */
function BucketCursor({
  bucketTimes,
  size,
  grid,
  horizontal,
}: {
  bucketTimes: number[];
  size: { width: number; height: number };
  grid: GridInsets;
  horizontal: boolean;
}) {
  const cursor = useTimeCursor();
  const index = cursor === null ? null : bucketIndexAt(bucketTimes, cursor);
  if (index === null) return null;
  const plot = plotWithin(size, grid);
  const along = (index + 0.5) / bucketTimes.length;
  return (
    <CursorLine
      horizontal={horizontal}
      style={
        horizontal
          ? { left: plot.left, top: plot.top + along * plot.height, width: plot.width }
          : { left: plot.left + along * plot.width, top: plot.top, height: plot.height }
      }
    />
  );
}

/** The drag-to-zoom selection, over whole buckets `from` to `to`. */
function BucketBrush({
  from,
  to,
  count,
  size,
  grid,
  horizontal,
}: {
  from: number;
  to: number;
  count: number;
  size: { width: number; height: number };
  grid: GridInsets;
  horizontal: boolean;
}) {
  const plot = plotWithin(size, grid);
  const band = (horizontal ? plot.height : plot.width) / count;
  const start = from * band;
  const length = (to - from + 1) * band;
  return (
    <Brush
      horizontal={horizontal}
      style={
        horizontal
          ? { left: plot.left, width: plot.width, top: plot.top + start, height: length }
          : { left: plot.left + start, width: length, top: plot.top, height: plot.height }
      }
    />
  );
}

export function BarChartVisualization({
  spec,
  data,
  timeRange,
  onTimeRangeChange,
}: VisualizationProps<BarChartSpec>) {
  const formatter = useMemo(() => createValueFormatter(spec.valueFormat), [spec.valueFormat]);
  const { showLegend, stacking, orientation, showValues, colors } = spec;
  const horizontal = orientation === "horizontal";
  const stacked = stacking !== "none";
  const percent = stacking === "percent";

  const { chartData, series, isTimeAxis } = useMemo(
    () => buildBarChartModel(data ?? [], colors),
    [data, colors],
  );
  const { activeSeries, toggleSeries, isOnLegend, gridBottom, legend } = useSeriesLegend(
    series,
    showLegend,
  );

  const chartElementRef = useRef<HTMLDivElement>(null);
  const [tooltipState, setTooltipState] = useState<{
    clientX: number;
    clientY: number;
    index: number;
  } | null>(null);
  /** Bucket indices a drag-to-zoom runs between. */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const { set: setCursor, clear: clearCursor } = usePointTimeCursor();

  const hasChart = !!data && chartData.length > 0 && series.length > 0;
  const clearTooltip = useCallback(() => setTooltipState(null), []);
  const mounted = useEChart(chartElementRef, hasChart, clearTooltip);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;
  const width = mounted?.width ?? 0;

  // Bars over time share the dashboard's time cursor, one bucket at a time.
  const bucketTimes = useMemo(
    () => (isTimeAxis ? chartData.map((row) => Number(row[X_KEY])) : null),
    [chartData, isTimeAxis],
  );

  // Labelled like every other time axis on the dashboard: the same round
  // times, each on the bar whose bucket holds it.
  const categoryLabels = useMemo(() => {
    if (!bucketTimes) return chartData.map((row) => String(row[X_KEY]));
    const domain: [number, number] = [timeRange.from.getTime(), timeRange.to.getTime()];
    const format = timeLabelFormatter(domain);
    const labels = bucketTimes.map(() => "");
    for (const tick of timeTicks(domain)) {
      const index = bucketIndexAt(bucketTimes, tick);
      if (index !== null) labels[index] = format(tick);
    }
    return labels;
  }, [chartData, bucketTimes, timeRange]);

  const ids = useMemo(() => series.map(({ id }) => id), [series]);
  const drawn = useMemo(
    () => (percent ? toShares(chartData, ids) : chartData),
    [percent, chartData, ids],
  );

  // Fit the value axis to what is drawn: each bar alone, or each stack's
  // positive and negative piles (ECharts stacks by sign). Bars grow from zero,
  // so zero is always in range.
  const { scale, format: formatValueTick } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const row of drawn) {
      let positive = 0;
      let negative = 0;
      for (const id of ids) {
        const value = row[id];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (stacked) {
          if (value >= 0) positive += value;
          else negative += value;
        } else {
          lo = Math.min(lo, value);
          hi = Math.max(hi, value);
        }
      }
      lo = Math.min(lo, negative);
      hi = Math.max(hi, positive);
    }
    return percent
      ? niceValueAxis(SHARE_FORMAT, lo, hi, { min: lo < 0 ? -1 : 0, max: hi > 0 ? 1 : 0 })
      : niceValueAxis(formatter, lo, hi);
  }, [drawn, formatter, ids, stacked, percent]);

  // Value labels show the raw value, also under percent stacking.
  const valueLabels = useMemo(
    () =>
      showValues
        ? new Map(
            ids.map((id) => [
              id,
              chartData.map((row) => {
                const value = row[id];
                return typeof value === "number" ? formatter.format(value) : "";
              }),
            ]),
          )
        : null,
    [showValues, ids, chartData, formatter],
  );

  // Text widths that depend on the data alone, kept apart from the geometry
  // below so resizing does not measure every label again.
  const measured = useMemo(() => {
    if (!theme) return null;
    const measure = createTextMeasurer(theme.fontFamily);
    const tickLabels = scale.ticks.map(formatValueTick);
    let widestValueLabel = 0;
    // Only labels drawn past the bar end need room inside the canvas.
    if (valueLabels && !stacked) {
      const measureValue = createTextMeasurer(theme.fontFamily, VALUE_LABEL_FONT_SIZE);
      for (const labels of valueLabels.values()) {
        for (const label of labels)
          widestValueLabel = Math.max(widestValueLabel, measureValue(label));
      }
    }
    return {
      measure,
      valueAxisWidth: axisLabelsWidth(tickLabels, measure),
      widestTick: Math.max(0, ...tickLabels.map(measure)),
      widestValueLabel,
      categoryAxisWidth: horizontal ? axisLabelsWidth(categoryLabels, measure) : 0,
    };
  }, [theme, scale, formatValueTick, valueLabels, stacked, horizontal, categoryLabels]);

  // Time labels already sit only on the bars that hold a round time.
  const tickInterval = bucketTimes
    ? 0
    : Math.max(0, Math.ceil(chartData.length / MAX_CATEGORY_TICKS) - 1);

  const layout = useMemo(() => {
    if (!measured) return null;
    const { measure, valueAxisWidth, widestTick, widestValueLabel } = measured;
    const categoryAxisWidth = Math.min(
      measured.categoryAxisWidth,
      Math.max(MIN_CATEGORY_AXIS_WIDTH, width * 0.3),
    );
    const grid: GridInsets = {
      // Snug to the panel like the time series: room only for value labels
      // above or beside the bars, and for the last value tick, centered on
      // the top or right edge.
      top: horizontal
        ? 0
        : widestValueLabel > 0
          ? VALUE_LABEL_FONT_SIZE + 12
          : VALUE_LABEL_OVERHANG,
      bottom: gridBottom,
      ...(horizontal
        ? {
            left: categoryAxisWidth,
            right: Math.ceil(
              Math.max(
                widestTick / 2,
                widestValueLabel > 0 ? widestValueLabel + PLOT_EDGE_INSET : 0,
              ),
            ),
          }
        : { left: valueAxisWidth, right: 0 }),
    };
    // Each category label owns its band (vertical) or the axis width
    // (horizontal); long ones are cut in the middle to fit it. Only the
    // labels ECharts shows at this tick interval are fitted.
    const shown = categoryLabels.filter(
      (label, index) => label && index % (tickInterval + 1) === 0,
    ).length;
    const plotWidth = width - grid.left - grid.right;
    const band = plotWidth / chartData.length;
    const labelPx = horizontal
      ? categoryAxisWidth - AXIS_LABEL_MARGIN - VALUE_AXIS_EDGE_INSET
      : plotWidth / Math.max(1, shown) - 8;
    const fittedLabels = categoryLabels.map((label, index) => {
      if (index % (tickInterval + 1) !== 0) return "";
      const fitted = fitMiddle(label, labelPx, measure);
      // A label centered on one of the last bars could run past the panel's
      // right edge: it goes unlabelled rather than cut off.
      const room = (chartData.length - index - 0.5) * band;
      return !horizontal && room < measure(fitted) / 2 ? "" : fitted;
    });
    return { grid, fittedLabels };
  }, [measured, width, horizontal, gridBottom, chartData.length, tickInterval, categoryLabels]);

  useEffect(() => {
    const element = chartElementRef.current;
    if (!chart || !theme || !layout || !element) return;
    const plain = plainAxisOption(theme);
    const categoryAxis = {
      type: "category" as const,
      // Index keys: two time buckets can share a display label.
      data: layout.fittedLabels.map((_, index) => String(index)),
      inverse: horizontal,
      ...plain,
      axisLabel: {
        ...plain.axisLabel,
        interval: tickInterval,
        formatter: (_: string, index: number) => layout.fittedLabels[index] ?? "",
      },
    };
    const valueAxis = valueAxisOption({ theme, scale, format: formatValueTick });
    const option: ChartOption = {
      animation: false,
      grid: gridOption(layout.grid),
      xAxis: horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : valueAxis,
      series: series.map(({ id, color: cssColor }): BarSeriesOption => {
        // The canvas can't read CSS variables, so a themed color resolves here.
        const color = resolveCssColor(element, cssColor);
        const dimmed = activeSeries !== null && activeSeries !== id;
        const labels = valueLabels?.get(id);
        return {
          id,
          name: id,
          type: "bar",
          data: drawn.map((row) => {
            const value = row[id];
            return typeof value === "number" ? value : null;
          }),
          stack: stacked ? "stack" : undefined,
          barMaxWidth: 64,
          barCategoryGap: "10%",
          silent: true,
          itemStyle: { color, opacity: dimmed ? 0.25 : 1 },
          // Dense bars would print their values over each other.
          labelLayout: { hideOverlap: true },
          label: {
            show: !!labels,
            position: stacked ? "inside" : horizontal ? "right" : "top",
            // Inside a stacked bar the label sits on the bar's own color;
            // elsewhere it sits on the panel.
            color: stacked
              ? (readableForeground(color)?.color ?? theme.foregroundColor)
              : theme.foregroundColor,
            fontFamily: theme.fontFamily,
            fontSize: VALUE_LABEL_FONT_SIZE,
            opacity: dimmed ? 0.25 : 1,
            formatter: ({ dataIndex }: { dataIndex: number }) => labels?.[dataIndex] ?? "",
          },
        };
      }),
    };
    chart.setOption(option, { notMerge: true });
  }, [
    activeSeries,
    chart,
    drawn,
    formatValueTick,
    horizontal,
    layout,
    scale,
    series,
    stacked,
    theme,
    tickInterval,
    valueLabels,
  ]);

  /** The bucket under the pointer: null outside the plot, or with `clamped`
   * the nearest bucket at its edge (a drag running past it). */
  const bucketAt = (e: React.MouseEvent, clamped = false): number | null => {
    const element = chartElementRef.current;
    const plot = element && layout ? getPlotRect(element, layout.grid) : null;
    if (!plot) return null;
    const inPlot =
      e.clientX >= plot.left &&
      e.clientX <= plot.left + plot.width &&
      e.clientY >= plot.top &&
      e.clientY <= plot.top + plot.height;
    if (!inPlot && !clamped) return null;
    const ratio = horizontal
      ? ratioWithin(e.clientY, plot.top, plot.height)
      : ratioWithin(e.clientX, plot.left, plot.width);
    return Math.min(chartData.length - 1, Math.floor(ratio * chartData.length));
  };

  const clearHover = () => {
    setTooltipState(null);
    clearCursor();
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (drag) {
      const to = bucketAt(e, true);
      if (to !== null && to !== drag.to) setDrag({ ...drag, to });
    }
    const index = isOnLegend(e.target) ? null : bucketAt(e);
    if (index === null) return clearHover();
    setTooltipState({ clientX: e.clientX, clientY: e.clientY, index });
    const bucket = bucketTimes?.[index];
    if (bucket !== undefined) setCursor(bucket);
  };

  // Bars over time zoom like the time series: drag across buckets to show
  // just those.
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!bucketTimes || e.button !== 0 || isOnLegend(e.target)) return;
    const from = bucketAt(e);
    if (from === null) return;
    setDrag({ from, to: from });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerUp = () => {
    setDrag(null);
    if (!drag || !bucketTimes || drag.from === drag.to) return;
    const first = Math.min(drag.from, drag.to);
    const last = Math.max(drag.from, drag.to);
    const start = bucketTimes[first];
    const lastStart = bucketTimes[last];
    if (start === undefined || lastStart === undefined) return;
    // The last bucket runs to the next one's start.
    const step = (lastStart - start) / (last - first);
    const end = bucketTimes[last + 1] ?? lastStart + step;
    clearHover();
    onTimeRangeChange({ from: new Date(start), to: new Date(end) });
  };

  if (!hasChart) {
    return (
      <PanelEmptyState
        icon={BarChart3}
        data={data}
        unusable="The result needs at least one numeric column."
      />
    );
  }

  const tooltipRow = tooltipState ? chartData[tooltipState.index] : undefined;
  const tooltipX = tooltipRow?.[X_KEY];

  return (
    <div
      className="relative h-full w-full text-muted-foreground"
      onMouseMove={handleMouseMove}
      onMouseLeave={clearHover}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      <div ref={chartElementRef} className="pointer-events-none h-full w-full" />
      {bucketTimes && mounted && layout && (
        <BucketCursor
          bucketTimes={bucketTimes}
          size={mounted}
          grid={layout.grid}
          horizontal={horizontal}
        />
      )}
      {drag && mounted && layout && (
        <BucketBrush
          from={Math.min(drag.from, drag.to)}
          to={Math.max(drag.from, drag.to)}
          count={chartData.length}
          size={mounted}
          grid={layout.grid}
          horizontal={horizontal}
        />
      )}
      {showLegend && <SeriesLegend {...legend} onToggle={toggleSeries} />}
      {tooltipState && tooltipRow && (
        <CursorTooltip x={tooltipState.clientX} y={tooltipState.clientY}>
          <SeriesTooltipContent
            title={isTimeAxis ? new Date(Number(tooltipX)).toLocaleString() : String(tooltipX)}
            rows={seriesTooltipRows(series, tooltipRow, activeSeries, formatter.format)}
          />
        </CursorTooltip>
      )}
    </div>
  );
}
