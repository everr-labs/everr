import { chartLabel } from "@everr/ui/lib/chart-label";
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
import { useEffect, useMemo, useRef } from "react";
import { bucketIndexAt, samplingStep } from "../data-utils";
import {
  AXIS_LABEL_MARGIN,
  axisLabelsWidth,
  createTextMeasurer,
  niceValueAxis,
  plainAxisOption,
  fitTimeTicks,
  timeLabelFormatter,
  VALUE_AXIS_EDGE_INSET,
  VALUE_LABEL_OVERHANG,
  valueAxisOption,
} from "../echarts/axis";
import { type GridInsets, gridOption, plotWithin } from "../echarts/plot-rect";
import {
  SeriesLegend,
  seriesTooltipRows,
  useSeriesLegend,
} from "@everr/ui/components/series-legend";
import { resolveCssColor, useEChart } from "@everr/ui/hooks/use-echart";
import type { VisualizationProps } from "../index";
import { type TimeScale, TimeTrackOverlay, useTimeTrack } from "../time-track";
import { createValueFormatter } from "../value-format";
import { buildBarChartModel, X_KEY } from "./bar-chart-data";
import type { BarChartSpec } from "./spec";
import { PanelEmptyState } from "../panel-empty-state";

echarts.use([BarChart, LabelLayout]);

type ChartOption = ComposeOption<BarSeriesOption | GridComponentOption>;

const MAX_CATEGORY_TICKS = 8;
const VALUE_LABEL_FONT_SIZE = 10;
const PLOT_EDGE_INSET = 12;
/** The least space between two category labels. */
const LABEL_GAP = 8;
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
 * Where instants fall across bars laid out one bucket each, by index: within
 * its bar, a bucket's time runs evenly from start to end. An instant in a
 * bucket the query skipped has no bar.
 */
function bucketScale(starts: readonly number[], step: number): TimeScale {
  const count = starts.length;
  return {
    // The plot's far edge is the last instant in the last bucket: its end is
    // the next bucket's start, which no bar holds.
    timeAt: (ratio) => {
      const along = ratio * count;
      const index = Math.min(count - 1, Math.floor(along));
      return (starts[index] ?? 0) + Math.min((along - index) * step, Math.max(0, step - 1));
    },
    ratioAt: (time) => {
      const index = bucketIndexAt(starts, step, time);
      if (index === null) return null;
      const within = step > 0 ? (time - (starts[index] ?? time)) / step : 0.5;
      return (index + within) / count;
    },
  };
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
  const hasChart = !!data && chartData.length > 0 && series.length > 0;
  const mounted = useEChart(chartElementRef, hasChart);
  const chart = mounted?.chart ?? null;
  const theme = mounted?.theme ?? null;
  const width = mounted?.width ?? 0;

  // Bars over time share the dashboard's time cursor and zoom.
  const bucketTimes = useMemo(
    () => (isTimeAxis ? chartData.map((row) => Number(row[X_KEY])) : null),
    [chartData, isTimeAxis],
  );
  // Each bucket's width: how often the series are sampled, each on its own,
  // so merged queries sampled at offset times don't narrow it.
  const bucketWidth = useMemo(
    () =>
      bucketTimes
        ? samplingStep(
            series.map(({ id }) =>
              bucketTimes.filter((_, i) => typeof chartData[i]?.[id] === "number"),
            ),
          )
        : 0,
    [bucketTimes, chartData, series],
  );
  const timeScale = useMemo(
    () => (bucketTimes ? bucketScale(bucketTimes, bucketWidth) : null),
    [bucketTimes, bucketWidth],
  );

  // Bars over time name times as every other time axis over the time they
  // span does: the dashboard's range when the bars cover it, their own when a
  // query fixes its times.
  const timeLabels = useMemo(() => {
    if (!bucketTimes) return null;
    const first = bucketTimes[0] ?? 0;
    const end = (bucketTimes.at(-1) ?? first) + bucketWidth;
    const domain: [number, number] =
      end > first ? [first, end] : [timeRange.from.getTime(), timeRange.to.getTime()];
    // A bar naming its own time does so as precisely as bars are apart, so
    // bars finer than the axis's round times read apart.
    const barFormat = timeLabelFormatter(domain, bucketWidth || domain[1] - domain[0]);
    return { domain, barLabels: bucketTimes.map(barFormat) };
  }, [bucketTimes, bucketWidth, timeRange]);
  const categoryLabels = useMemo(
    () => timeLabels?.barLabels ?? chartData.map((row) => String(row[X_KEY])),
    [timeLabels, chartData],
  );

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
      ? // Shares run to ±100%; with no share at all (only zeros), 0 to 100%.
        niceValueAxis(SHARE_FORMAT, lo, hi, {
          min: lo < 0 ? -1 : 0,
          max: hi > 0 || lo >= 0 ? 1 : 0,
        })
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
    const plotWidth = width - grid.left - grid.right;
    const band = plotWidth / chartData.length;
    // Centered on its bar, a label near the right edge has only the room to
    // its side.
    const roomAt = (index: number) => 2 * (chartData.length - index - 0.5) * band;
    if (!horizontal && timeLabels && bucketTimes) {
      const fitted = fitTimeLabels(timeLabels, bucketTimes, bucketWidth, plotWidth, band, measure);
      // A round time would misread cut short: one with no room goes unlabelled.
      if (fitted) {
        return {
          grid,
          fittedLabels: fitted.map((label, index) =>
            measure(label) <= roomAt(index) ? label : "",
          ),
        };
      }
    }
    // Otherwise every so many bars are labelled, each label cut in the middle
    // to its share of the plot (vertical) or to the axis width (horizontal).
    const every = Math.ceil(chartData.length / MAX_CATEGORY_TICKS);
    const labelPx = horizontal
      ? categoryAxisWidth - AXIS_LABEL_MARGIN - VALUE_AXIS_EDGE_INSET
      : plotWidth / Math.ceil(chartData.length / every) - LABEL_GAP;
    const fittedLabels = categoryLabels.map((label, index) => {
      if (index % every !== 0) return "";
      if (horizontal) return fitMiddle(label, labelPx, measure);
      return fitMiddle(label, Math.min(labelPx, roomAt(index)), measure);
    });
    return { grid, fittedLabels };
  }, [
    measured,
    width,
    horizontal,
    gridBottom,
    chartData.length,
    categoryLabels,
    timeLabels,
    bucketTimes,
    bucketWidth,
  ]);

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
        // Every label is placed above; skipped bars have an empty one.
        interval: 0,
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
    valueLabels,
  ]);

  // Zooms snap out to whole buckets, but never past the time range: buckets
  // start on round times, so the outer ones can reach beyond it. Bars a query
  // fixes outside the range zoom to their own times.
  const zoomToBuckets = ({ from, to }: { from: Date; to: Date }) => {
    if (!bucketTimes) return;
    const startOf = (time: number) => {
      const index = bucketIndexAt(bucketTimes, bucketWidth, time);
      return index === null ? time : (bucketTimes[index] ?? time);
    };
    const first = startOf(from.getTime());
    const end = startOf(to.getTime()) + bucketWidth;
    const clamped = {
      from: Math.max(first, timeRange.from.getTime()),
      to: Math.min(end, timeRange.to.getTime()),
    };
    const zoom = clamped.to > clamped.from ? clamped : { from: first, to: end };
    if (zoom.to > zoom.from) {
      onTimeRangeChange({ from: new Date(zoom.from), to: new Date(zoom.to) });
    }
  };

  const track = useTimeTrack({
    chartElementRef,
    size: mounted,
    grid: layout?.grid ?? null,
    scale: timeScale,
    vertical: horizontal,
    onTimeRangeChange: zoomToBuckets,
    ignore: isOnLegend,
    itemAt: (at) =>
      Math.min(chartData.length - 1, Math.floor((horizontal ? at.y : at.x) * chartData.length)),
  });
  const { hover } = track;

  if (!hasChart) {
    return (
      <PanelEmptyState
        icon={BarChart3}
        data={data}
        unusable="The result needs at least one numeric column."
      />
    );
  }

  const tooltipRow = hover ? chartData[hover.target] : undefined;
  const tooltipX = tooltipRow?.[X_KEY];

  return (
    <div className="relative h-full w-full text-muted-foreground" {...track.handlers}>
      {/* Hover is ours: ECharts would track the pointer too, forcing a layout per move. */}
      {/* The canvas has no text of its own: say what it shows. */}
      <p className="sr-only">
        {chartLabel(
          "Bar chart",
          series.map(({ label }) => label),
        )}
      </p>
      <div ref={chartElementRef} aria-hidden className="pointer-events-none h-full w-full" />
      {timeScale && mounted && layout && (
        <TimeTrackOverlay
          scale={timeScale}
          vertical={horizontal}
          brush={track.brush}
          plot={plotWithin(mounted, layout.grid)}
        />
      )}
      {showLegend && <SeriesLegend {...legend} onToggle={toggleSeries} />}
      {hover && tooltipRow && (
        <CursorTooltip x={hover.x} y={hover.y}>
          <SeriesTooltipContent
            title={isTimeAxis ? new Date(Number(tooltipX)).toLocaleString() : String(tooltipX)}
            rows={seriesTooltipRows(series, tooltipRow, activeSeries, formatter.format)}
          />
        </CursorTooltip>
      )}
    </div>
  );
}

/**
 * Time labels for bars over time. Bars with room to each name their own
 * time, and distinct ones, do. Otherwise the round times across them, each on
 * the bar whose bucket holds it, as many as fit the plot and a whole number
 * of bars apart where the bucket width allows. Null when fewer than two land
 * on a bar, e.g. buckets as wide as the ticks are apart.
 */
function fitTimeLabels(
  { domain, barLabels }: { domain: [number, number]; barLabels: string[] },
  bucketTimes: number[],
  bucketWidth: number,
  plotWidth: number,
  band: number,
  measure: (text: string) => number,
): string[] | null {
  const widest = Math.max(0, ...barLabels.map(measure)) + LABEL_GAP;
  // Bars narrower than the axis's precision, e.g. half days on an axis of
  // days, would repeat each other.
  if (widest <= band && new Set(barLabels).size === barLabels.length) return barLabels;
  if (bucketWidth <= 0) return null;
  const { ticks, format } = fitTimeTicks(domain, plotWidth, measure, bucketWidth);
  const labels = bucketTimes.map(() => "");
  let placed = 0;
  for (const tick of ticks) {
    const index = bucketIndexAt(bucketTimes, bucketWidth, tick);
    if (index === null || labels[index]) continue;
    labels[index] = format(tick);
    placed++;
  }
  return placed >= 2 ? labels : null;
}
