import { isNumericValue } from "@/lib/numeric";
import { detectTimeKey, toNumber, toTimestamp } from "../data-utils";
import type { QueryResultRow } from "../index";
import type { HeatmapSpec } from "./spec";

export interface HeatmapCell {
  /** Cell bounds in ms, clamped to the domain. */
  start: number;
  end: number;
  /** Index into `yBuckets`. */
  bucket: number;
  value: number;
}

export interface HeatmapModel {
  /** Y-bucket labels in display order, top row first. */
  yBuckets: string[];
  cells: HeatmapCell[];
  /** Color domain [min, max]. */
  domain: [number, number];
}

// Separator for the (ts, bucket) accumulator key — a control char no real
// bucket label contains, so labels with digits can't collide with timestamps.
const SEP = "\u001f";

/**
 * A time × bucket grid of summed values from every frame's long-format rows
 * (time column, y-bucket column, numeric value column). Each cell spans from
 * its timestamp to the next distinct timestamp (the grid step — the smallest
 * gap between samples), clamped to the domain. Rows landing on the same
 * (time, bucket) cell — within a frame or across frames — sum.
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

  // Column width: the smallest gap between distinct samples. A single
  // timestamp has no gap to measure — its cell spans the whole domain.
  const times = [...timesSeen].sort((a, b) => a - b);
  let step = domain[1] - domain[0];
  for (let i = 1; i < times.length; i++) {
    const cur = times[i];
    const prev = times[i - 1];
    if (cur === undefined || prev === undefined) continue;
    const gap = cur - prev;
    if (gap > 0 && gap < step) step = gap;
  }

  const cells: HeatmapCell[] = [];
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const ts of times) {
    for (let b = 0; b < yBuckets.length; b++) {
      const value = sums.get(`${ts}${SEP}${yBuckets[b]}`);
      if (value === undefined) continue;
      const start = Math.max(ts, domain[0]);
      const end = Math.min(ts + step, domain[1]);
      if (end <= start) continue;
      cells.push({ start, end, bucket: b, value });
      if (value < lo) lo = value;
      if (value > hi) hi = value;
    }
  }

  const min = spec.min ?? (cells.length ? Math.min(0, lo) : 0);
  const max = spec.max ?? (cells.length ? hi : 1);
  return { yBuckets, cells, domain: [min, max] };
}
