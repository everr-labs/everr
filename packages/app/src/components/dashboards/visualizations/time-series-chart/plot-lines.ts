import type { ChartModel, ChartSeries, SeriesPoint } from "./time-series-data";
import { TS_KEY } from "./time-series-data";

/** M4 keeps at most this many points per pixel column: the first, the last,
 * the lowest and the highest. */
const POINTS_PER_COLUMN = 4;

/** One series as ECharts draws it. */
interface DrawnLine {
  id: ChartSeries["id"];
  color: ChartSeries["color"];
  /**
   * The series option's `data`, ascending in time. Every point is one of the
   * model's own, never moved or made up, and a line with nothing to drop is
   * the model's own array: do not mutate it.
   */
  points: SeriesPoint[];
}

/** What a time-series chart draws, decided before it knows its width. */
interface PlotLines {
  /**
   * The lowest and highest value drawn: every numeric sample, or, stacked,
   * every band edge and zero. `[Infinity, -Infinity]` when nothing is numeric.
   *
   * It does not depend on the width. The value axis sizes its labels, the
   * labels size the plot, and the plot's width sizes the columns, so an extent
   * taken from thinned lines would chase its own tail. It need not be: every
   * column keeps its lowest and highest point, so thinning never moves it.
   */
  extent: readonly [low: number, high: number];
  /**
   * The lines to hand ECharts for a plot `width` CSS pixels wide on a canvas
   * of `pixelRatio` device pixels to each, one per model series in model order.
   *
   * A line with more points than four to each column of device pixels keeps,
   * in every column, its first, last, lowest and highest point (M4, Jugel et
   * al. 2014): enough to draw the same line, so a spike one sample wide stays
   * as tall as it was. A line with fewer is drawn whole. Gap markers always
   * survive, and points on either side of one are never merged. Stacked lines
   * all keep the same timestamps, because ECharts stacks by index: the ones
   * any band's edge needs.
   *
   * A plot with no width yet gets every point.
   */
  forPlot(width: number, pixelRatio: number): DrawnLine[];
}

/**
 * The lines `model` draws. Hover and the tooltip keep reading the model, at
 * full resolution: only the drawing is thinned.
 */
export function plotLines(model: ChartModel, stacked: boolean): PlotLines {
  return stacked ? stackedLines(model) : ownLines(model);
}

/** Each series on its own timestamps. */
function ownLines({ series, domain }: ChartModel): PlotLines {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (const { data } of series) {
    for (const [, value] of data) {
      if (value === null) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
  }
  return {
    extent: [low, high],
    forPlot: (width, pixelRatio) => {
      const columns = columnsAcross(width * pixelRatio, domain);
      return series.map(({ id, color, data }) => ({
        id,
        color,
        points: columns ? thinLine(data, columns) : data,
      }));
    },
  };
}

/**
 * Every series on the merged timeline, as ECharts' stacking by index needs. A
 * missing or null sample adds nothing to its bucket, so it is 0: left
 * undefined it would corrupt the running offset of the series above it.
 */
function stackedLines({ chartData, series, domain }: ChartModel): PlotLines {
  const times = Float64Array.from(chartData, (row) => row[TS_KEY]);
  // ECharts stacks from zero, so a stack's axis always shows it.
  let low = 0;
  let high = 0;
  const tops = new Float64Array(times.length);
  const bands = series.map(({ id, color }) => {
    const points = chartData.map((row): SeriesPoint => {
      const value = row[id];
      return [row[TS_KEY], typeof value === "number" ? value : 0];
    });
    // Where this band's edge is drawn: the running sum in series order, signed
    // (`stackStrategy: "all"`).
    const edge = Float64Array.from(points, ([, value], i) => {
      const top = tops[i] + (value ?? 0);
      tops[i] = top;
      if (top < low) low = top;
      if (top > high) high = top;
      return top;
    });
    return { id, color, points, edge };
  });
  return {
    extent: [low, high],
    forPlot: (width, pixelRatio) => {
      const columns = columnsAcross(width * pixelRatio, domain);
      if (!columns || times.length <= POINTS_PER_COLUMN * columns.count) {
        return bands.map(({ id, color, points }) => ({ id, color, points }));
      }
      // One set of timestamps for every band: all that any edge needs. More
      // points than an edge's own leave it drawn the same.
      const keep = new Uint8Array(times.length);
      for (const { edge } of bands) markM4(times, edge, columns, keep);
      return bands.map(({ id, color, points }) => ({ id, color, points: pick(points, keep) }));
    },
  };
}

/** Columns of device pixels across a time domain: `time` falls in column
 * `floor((time - from) * perMs)`. */
interface Columns {
  count: number;
  from: number;
  perMs: number;
}

/** Null when columns cannot be placed (a plot with no width, a domain with no
 * span): nothing is thinned then. */
function columnsAcross(pixels: number, [from, to]: readonly [number, number]): Columns | null {
  const count = Math.ceil(pixels);
  if (!(count >= 1 && Number.isFinite(count) && to > from)) return null;
  return { count, from, perMs: count / (to - from) };
}

function thinLine(points: SeriesPoint[], columns: Columns): SeriesPoint[] {
  if (points.length <= POINTS_PER_COLUMN * columns.count) return points;
  const times = new Float64Array(points.length);
  const values = new Float64Array(points.length);
  points.forEach(([time, value], i) => {
    times[i] = time;
    values[i] = value ?? Number.NaN;
  });
  const keep = new Uint8Array(points.length);
  markM4(times, values, columns, keep);
  return pick(points, keep);
}

/**
 * Marks in `keep` the points of one line that M4 keeps: per pixel column, the
 * first, the last, the lowest and the highest. `times` ascend; a NaN value is
 * a gap marker, which is kept and ends the column on both sides. Marks are
 * only ever added, so several lines can share one `keep`.
 */
function markM4(
  times: Float64Array,
  values: Float64Array,
  { from, perMs }: Columns,
  keep: Uint8Array,
): void {
  let open = false;
  let column = 0;
  let first = 0;
  let last = 0;
  let lowest = 0;
  let highest = 0;
  let lowValue = 0;
  let highValue = 0;
  for (let i = 0; i < times.length; i++) {
    const value = values[i];
    if (Number.isNaN(value)) {
      if (open) markColumn(keep, first, last, lowest, highest);
      open = false;
      keep[i] = 1;
      continue;
    }
    // Not clamped: the bucket the model keeps left of the domain is a column
    // of its own, so the line still runs off the plot's edge as it did.
    const at = Math.floor((times[i] - from) * perMs);
    if (open && at === column) {
      last = i;
      if (value < lowValue) {
        lowValue = value;
        lowest = i;
      } else if (value > highValue) {
        highValue = value;
        highest = i;
      }
      continue;
    }
    if (open) markColumn(keep, first, last, lowest, highest);
    open = true;
    column = at;
    first = i;
    last = i;
    lowest = i;
    highest = i;
    lowValue = value;
    highValue = value;
  }
  if (open) markColumn(keep, first, last, lowest, highest);
}

function markColumn(
  keep: Uint8Array,
  first: number,
  last: number,
  lowest: number,
  highest: number,
): void {
  keep[first] = 1;
  keep[last] = 1;
  keep[lowest] = 1;
  keep[highest] = 1;
}

/** The marked points, in order; `points` itself when all of them are. */
function pick(points: SeriesPoint[], keep: Uint8Array): SeriesPoint[] {
  const kept = points.filter((_, i) => keep[i] === 1);
  return kept.length === points.length ? points : kept;
}
