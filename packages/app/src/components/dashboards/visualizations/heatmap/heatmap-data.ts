import { isNumericValue } from "#app/lib/numeric.ts";
import { detectTimeKey, samplingStep, toNumber, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { HeatmapSpec } from "./spec";

export interface HeatmapCell {
  /** Index into `yBuckets`. */
  bucket: number;
  /** Index into the column grid. */
  column: number;
  value: number;
  /** How many samples the value sums: sample times once time columns merge,
   * rows on a category grid. */
  samples: number;
}

export interface HeatmapModel {
  /** Y-bucket labels in display order, top row first. */
  yBuckets: string[];
  cells: HeatmapCell[];
  /** Color domain [min, max]. */
  domain: [number, number];
  columns: HeatmapColumns;
}

/**
 * The column grid the cells sit on. Over time it covers the whole range:
 * column k spans `start + k * step` to `start + (k + 1) * step`. Over
 * categories (`xColumn`), column k is `labels[k]`.
 */
export type HeatmapColumns = TimeColumns | { kind: "category"; labels: string[]; count: number };

type TimeColumns = { kind: "time"; start: number; step: number; count: number };

/** A time column's bounds in ms, clamped to the domain. */
export function columnSpan(
  { start, step }: TimeColumns,
  column: number,
  domain: [number, number],
): [number, number] {
  return [
    Math.max(start + column * step, domain[0]),
    Math.min(start + (column + 1) * step, domain[1]),
  ];
}

// Separator for the (x, bucket) accumulator key — a control char no real
// label contains, so "1" + "23" and "12" + "3" can't collide.
const SEP = "\u001f";

/** More columns than this would be narrower than a pixel on any panel. */
const MAX_COLUMNS = 1000;

/**
 * A time × bucket grid of summed values from every frame's long-format rows
 * (time column, y-bucket column, numeric value column), on a grid of columns
 * as wide as the typical gap between samples (`columnSpan` gives a column's
 * bounds, clamped to the domain). Rows landing on the same column and bucket,
 * within a frame or across frames, sum. With `xColumn` set the columns are
 * that column's values instead, and no time column is needed.
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
  const { yBuckets, cells, columns } =
    spec.xColumn === undefined
      ? buildTimeGrid(frames, spec, domain)
      : buildCategoryGrid(frames, spec, spec.xColumn);
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const { value } of cells) {
    if (value < lo) lo = value;
    if (value > hi) hi = value;
  }

  const min = spec.min ?? (cells.length ? Math.min(0, lo) : 0);
  const max = spec.max ?? (cells.length ? hi : 1);
  return { yBuckets, cells, domain: [min, max], columns };
}

type Grid = Omit<HeatmapModel, "domain">;

/** The y and value columns of a frame: the spec's when the frame has them,
 * else the first other column and the first other numeric one. */
function frameKeys(
  rows: QueryResultRow[],
  spec: HeatmapSpec,
  exclude: (string | undefined)[],
): { yKey: string; valueKey: string } | null {
  const [first] = rows;
  const keys = Object.keys(first);
  const yKey =
    spec.yColumn !== undefined && spec.yColumn in first
      ? spec.yColumn
      : keys.find((k) => !exclude.includes(k));
  if (yKey === undefined) return null;
  const valueKey =
    spec.valueColumn !== undefined && spec.valueColumn in first
      ? spec.valueColumn
      : keys.find(
          (k) => !exclude.includes(k) && k !== yKey && rows.some((row) => isNumericValue(row[k])),
        );
  return valueKey === undefined ? null : { yKey, valueKey };
}

/** Labels that are all numeric sort by value, `direction` 1 ascending and -1
 * descending; otherwise they keep first-seen order. */
function orderLabels(seen: Set<string>, direction: 1 | -1): string[] {
  const labels = [...seen];
  if (labels.some((label) => toNumber(label) === null)) return labels;
  return labels.sort((a, b) => direction * ((toNumber(a) ?? 0) - (toNumber(b) ?? 0)));
}

/**
 * A category × bucket grid: one column per distinct `xColumn` value, numeric
 * ones ascending left to right, otherwise in first-seen order. Frames without
 * the column are skipped. Rows sharing an x and a bucket sum.
 */
function buildCategoryGrid(frames: QueryResultRow[][], spec: HeatmapSpec, xKey: string): Grid {
  const sums = new Map<string, { value: number; samples: number }>();
  const xSeen = new Set<string>();
  const bucketsSeen = new Set<string>();

  for (const rows of frames) {
    if (!rows || rows.length === 0 || !(xKey in rows[0])) continue;
    const keys = frameKeys(rows, spec, [xKey, detectTimeKey(rows)]);
    if (!keys) continue;
    for (const row of rows) {
      const rawX = row[xKey];
      const rawBucket = row[keys.yKey];
      const value = toNumber(row[keys.valueKey]);
      if (rawX == null || rawBucket == null || value === null) continue;
      const x = String(rawX);
      const bucket = String(rawBucket);
      xSeen.add(x);
      bucketsSeen.add(bucket);
      const key = `${x}${SEP}${bucket}`;
      const sum = sums.get(key);
      if (sum) {
        sum.value += value;
        sum.samples += 1;
      } else {
        sums.set(key, { value, samples: 1 });
      }
    }
  }

  const labels = orderLabels(xSeen, 1);
  const yBuckets = orderLabels(bucketsSeen, -1);
  const cells: HeatmapCell[] = [];
  labels.forEach((x, column) => {
    yBuckets.forEach((bucket, b) => {
      const sum = sums.get(`${x}${SEP}${bucket}`);
      if (sum) cells.push({ bucket: b, column, ...sum });
    });
  });
  return { yBuckets, cells, columns: { kind: "category", labels, count: labels.length } };
}

function buildTimeGrid(
  frames: QueryResultRow[][],
  spec: HeatmapSpec,
  domain: [number, number],
): Grid {
  const sums = new Map<string, number>();
  const timesSeen = new Set<number>();
  const timesByBucket = new Map<string, Set<number>>();
  const bucketsSeen = new Set<string>();

  for (const rows of frames) {
    if (!rows || rows.length === 0) continue;
    const timeKey = detectTimeKey(rows);
    if (!timeKey) continue;
    const keys = frameKeys(rows, spec, [timeKey]);
    if (!keys) continue;

    for (const row of rows) {
      const ts = toTimestamp(row[timeKey]);
      const rawBucket = row[keys.yKey];
      const value = toNumber(row[keys.valueKey]);
      if (ts === null || rawBucket == null || value === null) continue;
      const bucket = String(rawBucket);
      timesSeen.add(ts);
      const bucketTimes = timesByBucket.get(bucket) ?? new Set<number>();
      timesByBucket.set(bucket, bucketTimes.add(ts));
      bucketsSeen.add(bucket);
      const key = `${ts}${SEP}${bucket}`;
      sums.set(key, (sums.get(key) ?? 0) + value);
    }
  }

  const yBuckets = orderLabels(bucketsSeen, -1);
  // Column width: the typical gap between one bucket's samples, so one stray
  // timestamp doesn't split the grid into slivers, and buckets sampled at
  // offset times (a at :00, b at :01) share columns rather than each getting
  // its own. Past MAX_COLUMNS it widens by whole gaps, so every column merges
  // the same number of samples and regular data doesn't stripe. A single
  // sample per bucket has no gap to measure: a cell then spans the range.
  const times = [...timesSeen].sort((a, b) => a - b);
  const span = domain[1] - domain[0];
  const sampled = samplingStep(
    [...timesByBucket.values()].map((set) => [...set].sort((a, b) => a - b)),
  );
  const gap = sampled || span;
  const merged = Math.max(1, Math.ceil(span / MAX_COLUMNS / gap));
  const step = gap * merged;

  // Columns are anchored on the samples and extended to cover the range, so
  // empty stretches keep their place on the axis. Without a gap there is
  // nothing to anchor: the one column is the range itself.
  const anchor = sampled ? times[0] : domain[0];
  const start = anchor + Math.floor((domain[0] - anchor) / step) * step;
  const count = Math.max(1, Math.ceil((domain[1] - start) / step));

  // Irregular samples need not sit on the grid: each goes to the nearest
  // sample slot (so jitter up to half a gap stays in its own column), in the
  // column holding that slot, and samples sharing a column and bucket sum.
  const byCell = new Map<string, HeatmapCell>();
  for (const ts of times) {
    if (ts >= domain[1]) continue;
    const slot = Math.round((Math.max(ts, domain[0]) - start) / gap);
    const column = Math.min(count - 1, Math.max(0, Math.floor(slot / merged)));
    if (ts + step <= domain[0]) continue;
    for (let b = 0; b < yBuckets.length; b++) {
      const value = sums.get(`${ts}${SEP}${yBuckets[b]}`);
      if (value === undefined) continue;
      const key = `${column}:${b}`;
      const cell = byCell.get(key);
      if (cell) {
        cell.value += value;
        cell.samples += 1;
      } else {
        byCell.set(key, { bucket: b, column, value, samples: 1 });
      }
    }
  }
  return {
    yBuckets,
    cells: [...byCell.values()],
    columns: { kind: "time", start, step, count },
  };
}
