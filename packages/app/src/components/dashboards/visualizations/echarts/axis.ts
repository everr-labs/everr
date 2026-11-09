import type { YAXisComponentOption } from "echarts";
import { niceLinearDomain } from "../data-utils";
import type { ValueFormatter } from "../value-format";
import type { ChartValueAxis } from "@everr/ui/components/series-chart";
import type { ChartTheme } from "@everr/ui/hooks/use-echart";

const AXIS_FONT_SIZE = 12;
export const AXIS_LABEL_MARGIN = 8;
/** Breathing room between the value labels and the panel edge. */
export const VALUE_AXIS_EDGE_INSET = 8;

const measurers = new Map<string, (text: string) => number>();

/** Pixel width of `text` in the chart's font, one canvas per font. Falls back
 * to an estimate where there is no canvas (tests). */
export function createTextMeasurer(fontFamily: string, fontSize = AXIS_FONT_SIZE) {
  const font = `${fontSize}px ${fontFamily}`;
  let measure = measurers.get(font);
  if (!measure) {
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = font;
    measure = (text: string) =>
      context ? context.measureText(text).width : text.length * fontSize * 0.58;
    measurers.set(font, measure);
  }
  return measure;
}

/** Room for the widest of `labels` plus the axis margin and edge inset. */
export function axisLabelsWidth(labels: string[], measure: (text: string) => number): number {
  return Math.ceil(Math.max(0, ...labels.map(measure)) + AXIS_LABEL_MARGIN + VALUE_AXIS_EDGE_INSET);
}

function axisLabelStyle(theme: ChartTheme) {
  return {
    color: theme.textColor,
    fontFamily: theme.fontFamily,
    fontSize: AXIS_FONT_SIZE,
    margin: AXIS_LABEL_MARGIN,
  };
}

/** A label-only axis (time or category): no line, ticks or grid lines, and
 * labels that would collide are dropped. */
export function plainAxisOption(theme: ChartTheme) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { ...axisLabelStyle(theme), hideOverlap: true },
  };
}

/** Row labels (heatmap buckets, timeline lanes) wider than this truncate. */
const MAX_ROW_LABEL_WIDTH = 120;
/** Room under a chart of rows for its time labels. */
export const TIME_AXIS_HEIGHT = 22;

/**
 * The category axis of a chart drawn as rows over time, top row first, and
 * its grid: the labels are as wide as the widest one up to a cap, and only
 * labels wider than the cap truncate, at the room it leaves.
 */
export function rowLabelAxis(theme: ChartTheme, labels: string[]) {
  const width = Math.min(
    MAX_ROW_LABEL_WIDTH,
    axisLabelsWidth(labels, createTextMeasurer(theme.fontFamily)),
  );
  const plain = plainAxisOption(theme);
  return {
    grid: { left: width, right: 0, top: 0, bottom: TIME_AXIS_HEIGHT },
    axis: {
      type: "category" as const,
      data: labels,
      inverse: true,
      ...plain,
      axisLabel: {
        ...plain.axisLabel,
        ...(width >= MAX_ROW_LABEL_WIDTH && {
          width: width - AXIS_LABEL_MARGIN - VALUE_AXIS_EDGE_INSET,
          overflow: "truncate" as const,
        }),
      },
    },
  };
}

const DAY = 86_400_000;

/** Time labels for an axis over `domain`: dates for multi-day ranges, hours
 * and minutes otherwise. */
export function timeLabelFormatter(domain: [number, number]): (value: number) => string {
  const format = new Intl.DateTimeFormat(
    undefined,
    domain[1] - domain[0] > DAY
      ? { month: "short", day: "numeric" }
      : { hour: "2-digit", minute: "2-digit", hour12: false },
  );
  return (value) => format.format(value);
}

/** A label-only time axis over `domain`, one tick per day at most. */
export function timeAxisOption(theme: ChartTheme, domain: [number, number]) {
  const plain = plainAxisOption(theme);
  return {
    type: "time" as const,
    min: domain[0],
    max: domain[1],
    splitNumber: 6,
    minInterval: domain[1] - domain[0] > DAY ? DAY : undefined,
    ...plain,
    axisLabel: { ...plain.axisLabel, formatter: timeLabelFormatter(domain) },
  };
}

/**
 * A linear value axis drawn on exactly the precomputed ticks, so the axis
 * width is measured from the labels ECharts shows. The ticks are handed over
 * as values rather than as a step: given `interval`, ECharts counts from a
 * fixed `min` (925, 945, …) instead of from round multiples (940, 960, …).
 */
export function valueAxisOption({
  theme,
  scale,
  format,
}: {
  theme: ChartTheme;
  scale: { domain: [number, number]; ticks: number[] };
  format: (value: number) => string;
}) {
  return {
    type: "value",
    min: scale.domain[0],
    max: scale.domain[1],
    axisLine: { show: false },
    // Hidden, but its values also place the split lines.
    axisTick: { show: false, customValues: scale.ticks },
    splitLine: { lineStyle: { color: theme.gridColor, opacity: 0.5 } },
    axisLabel: {
      ...axisLabelStyle(theme),
      customValues: scale.ticks,
      formatter: format,
    },
  } satisfies YAXisComponentOption;
}

/**
 * A value axis over `lo..hi` whose ticks are round in the unit the labels
 * show. The unit is picked once, from the data and any fixed bounds: picking
 * it from the rounded domain could cross a unit boundary (1000 KiB of data
 * rounding up to a 1024 KiB edge) and relabel the whole axis.
 */
export function niceValueAxis(
  formatter: ValueFormatter,
  lo: number,
  hi: number,
  bounds: { min?: number; max?: number } = {},
) {
  const reference = Math.max(
    0,
    ...[lo, hi, bounds.min, bounds.max]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .map(Math.abs),
  );
  const { divisor, format } = formatter.axisFor(reference);
  return { scale: niceLinearDomain(lo, hi, 5, { ...bounds, divisor }), format };
}

/** A `SeriesChart` value axis from 0 to `max`, its ticks round in the unit
 * `formatter` shows (2 MiB/s, not 1.9 MB/s). `format` labels the values. */
export function seriesValueAxis(
  formatter: ValueFormatter,
  max: number,
  format: (value: number) => string = formatter.format,
): ChartValueAxis {
  const { scale, format: tickFormat } = niceValueAxis(formatter, 0, max, { min: 0 });
  return { format, min: scale.domain[0], max: scale.domain[1], ticks: scale.ticks, tickFormat };
}
