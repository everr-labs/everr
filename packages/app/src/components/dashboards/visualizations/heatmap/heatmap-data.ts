import { isNumericValue } from "#app/lib/numeric.ts";
import { detectTimeKey, toNumber, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { HeatmapSpec } from "./spec";

export interface HeatmapCell {
  /** Cell bounds in ms, clamped to the domain. */
  start: number;
  end: number;
  /** Index into `yBuckets`. */
  bucket: number;
  /** Index into the column grid. */
  column: number;
  value: number;
}

export interface HeatmapModel {
  /** Y-bucket labels in display order, top row first. */
  yBuckets: string[];
  cells: HeatmapCell[];
  /** Color domain [min, max]. */
  domain: [number, number];
  /** The column grid the cells sit on, covering the whole time range:
   * column k spans `start + k * step` to `start + (k + 1) * step`. */
  columns: { start: number; step: number; count: number };
}

// Separator for the (ts, bucket) accumulator key — a control char no real
// bucket label contains, so labels with digits can't collide with timestamps.
const SEP = "\u001f";

/** More columns than this would be narrower than a pixel on any panel. */
const MAX_COLUMNS = 1000;

/**
 * A time × bucket grid of summed values from every frame's long-format rows
 * (time column, y-bucket column, numeric value column), on a grid of columns
 * as wide as the smallest gap between samples. Each cell spans its column,
 * clamped to the domain. Rows landing on the same column and bucket, within
 * a frame or across frames, sum.
 *
 * Y buckets that are all numeric (histogram bounds) sort like a y-axis,
 * largest at the top; otherwise rows keep first-seen order top-down.
 *
 * The color domain is `spec.min`/`spec.max` when set, else the data extent
 * with the min floored at 0 — so the ramp reads 0→max and cell colors don't
 * shift with whatever the window's lowest value happens to be.
 */
export function buildHeatmapModel(
  frames: QueryResultRow[][],
  spec: HeatmapSpec,
  domain: [number, number],
): HeatmapModel {
  const sums = new Map<string, number>();
  const timesSeen = new Set<number>();
  const bucketsSeen: string[] = [];
  let allNumericBuckets = true;

  for (const rows of frames) {
    if (!rows || rows.length === 0) continue;
    const timeKey = detectTimeKey(rows);
    if (!timeKey) continue;
    const [first] = rows;
    const keys = Object.keys(first);

    const yKey =
      spec.yColumn !== undefined && spec.yColumn in first
        ? spec.yColumn
        : keys.find((k) => k !== timeKey);
    if (yKey === undefined) continue;
    const valueKey =
      spec.valueColumn !== undefined && spec.valueColumn in first
        ? spec.valueColumn
        : keys.find(
            (k) => k !== timeKey && k !== yKey && rows.some((row) => isNumericValue(row[k])),
          );
    if (valueKey === undefined) continue;

    for (const row of rows) {
      const ts = toTimestamp(row[timeKey]);
      const rawBucket = row[yKey];
      const value = toNumber(row[valueKey]);
      if (ts === null || rawBucket == null || value === null) continue;
      const bucket = String(rawBucket);
      timesSeen.add(ts);
      if (!bucketsSeen.includes(bucket)) bucketsSeen.push(bucket);
      if (allNumericBuckets && toNumber(bucket) === null) {
        allNumericBuckets = false;
      }
      const key = `${ts}${SEP}${bucket}`;
      sums.set(key, (sums.get(key) ?? 0) + value);
    }
  }

  const yBuckets = allNumericBuckets
    ? [...bucketsSeen].sort((a, b) => (toNumber(b) ?? 0) - (toNumber(a) ?? 0))
    : bucketsSeen;

  // Column width: the smallest gap between distinct samples, but never so
  // narrow that the range needs more than MAX_COLUMNS of them (one stray
  // timestamp would otherwise split the grid into thousands). A single
  // timestamp has no gap to measure: its cell spans the whole range.
  const times = [...timesSeen].sort((a, b) => a - b);
  const span = domain[1] - domain[0];
  let step = span;
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1];
    if (gap > 0 && gap < step) step = gap;
  }
  step = Math.max(step, span / MAX_COLUMNS);

  // Columns are anchored on the samples and extended to cover the range, so
  // empty stretches keep their place on the axis. A lone sample anchors
  // nothing: its one column is the range itself.
  const anchor = times.length > 1 ? times[0] : domain[0];
  const start = anchor + Math.floor((domain[0] - anchor) / step) * step;
  const count = Math.max(1, Math.ceil((domain[1] - start) / step));

  // Irregular samples need not sit on the grid: each goes in the column its
  // start falls in, and samples sharing a column and bucket sum.
  const byCell = new Map<string, HeatmapCell>();
  for (const ts of times) {
    if (ts >= domain[1]) continue;
    const column = Math.min(
      count - 1,
      Math.max(0, Math.floor((Math.max(ts, domain[0]) - start) / step)),
    );
    if (ts + step <= domain[0]) continue;
    const cellStart = Math.max(start + column * step, domain[0]);
    const cellEnd = Math.min(start + (column + 1) * step, domain[1]);
    for (let b = 0; b < yBuckets.length; b++) {
      const value = sums.get(`${ts}${SEP}${yBuckets[b]}`);
      if (value === undefined) continue;
      const key = `${column}:${b}`;
      const cell = byCell.get(key);
      if (cell) cell.value += value;
      else byCell.set(key, { start: cellStart, end: cellEnd, bucket: b, column, value });
    }
  }
  const cells = [...byCell.values()];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const { value } of cells) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }

  const min = spec.min ?? (cells.length ? Math.min(0, lo) : 0);
  const max = spec.max ?? (cells.length ? hi : 1);
  return { yBuckets, cells, domain: [min, max], columns: { start, step, count } };
}
