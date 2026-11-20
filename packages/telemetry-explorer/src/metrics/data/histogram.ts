import type { MetricAggregation } from "./schemas";
import type { BucketMerge, BucketMergeNote, MetricHeatmap, MetricSeries } from "./types";

/**
 * The value below which a fraction `q` of observations fall, interpolated
 * linearly inside the bucket that holds it, as Prometheus's
 * `histogram_quantile` does. OTLP explicit bounds are upper bounds: bucket i
 * holds (bounds[i-1], bounds[i]], and one more bucket holds everything above
 * the last bound. That bucket has no upper edge, so a quantile landing in it
 * reports the last bound. The first bucket starts at 0 when its bound is
 * positive. Null when nothing was observed.
 */
export function bucketQuantile(
  q: number,
  bounds: readonly number[],
  counts: readonly number[],
): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  if (bounds.length === 0) return null;
  const rank = q * total;
  let below = 0;
  for (let i = 0; i < counts.length; i++) {
    const inBucket = counts[i] ?? 0;
    if (below + inBucket >= rank && inBucket > 0) {
      if (i >= bounds.length) return bounds[bounds.length - 1] ?? null;
      const upper = bounds[i] ?? 0;
      const lower = i === 0 ? Math.min(0, upper) : (bounds[i - 1] ?? 0);
      return lower + (upper - lower) * ((rank - below) / inBucket);
    }
    below += inBucket;
  }
  return bounds[bounds.length - 1] ?? null;
}

const QUANTILES: Partial<Record<MetricAggregation, number>> = { p50: 0.5, p95: 0.95, p99: 0.99 };

/** One interval of one group: observations recorded in that interval. */
export interface HistogramInterval {
  ts: number;
  labels: string[];
  bounds: number[];
  counts: number[];
  count: number;
  sum: number;
  /** Observations per second, each series' over the time its changes cover. */
  rate: number;
}

function reduce(interval: HistogramInterval, aggregation: MetricAggregation) {
  const quantile = QUANTILES[aggregation];
  if (quantile !== undefined) return bucketQuantile(quantile, interval.bounds, interval.counts);
  if (aggregation === "rate") return interval.rate;
  // avg
  return interval.count > 0 ? interval.sum / interval.count : null;
}

export interface BucketLayout {
  bounds: number[];
  /** Set when more than one layout went into these bounds. */
  merge?: BucketMerge;
  layouts: number;
}

/**
 * The bounds a set of series is charted on. One layout is used as is. When
 * the coarsest layout's bounds are all present in every other layout, as when
 * one SDK refines another's defaults, those bounds keep every count exact,
 * the way Prometheus merges native histograms of different resolutions. They
 * must also reach the highest bound of every layout: a percentile above the
 * last bound reports that bound, so shared bounds that stop short would cap
 * the line below observations a finer layout measured. Otherwise the union
 * keeps every layout's detail, at the cost of assuming observations are
 * spread evenly inside each bucket, the same assumption `bucketQuantile`
 * already makes.
 */
export function bucketLayout(layouts: readonly (readonly number[])[]): BucketLayout {
  const distinct = [...new Map(layouts.map((b) => [JSON.stringify(b), b])).values()];
  const [first] = distinct;
  if (distinct.length <= 1) return { bounds: first ? [...first] : [], layouts: distinct.length };
  const coarsest = distinct.reduce((a, b) => (b.length < a.length ? b : a));
  const highest = Math.max(...distinct.map((layout) => layout[layout.length - 1] ?? -Infinity));
  const nested = distinct.every((layout) => coarsest.every((bound) => layout.includes(bound)));
  if (nested && coarsest[coarsest.length - 1] === highest) {
    return { bounds: [...coarsest], merge: "shared", layouts: distinct.length };
  }
  const union = [...new Set(distinct.flat())].sort((a, b) => a - b);
  return { bounds: union, merge: "interpolated", layouts: distinct.length };
}

/**
 * Moves bucket counts recorded with `bounds` onto `target`. Each bucket's
 * count is split over the target buckets it overlaps, by width; a bucket that
 * fits in one target bucket moves whole, which makes the move exact when
 * `target` is a subset of `bounds`. Observations above the last bound have no
 * upper edge, so they go to the target bucket just above that bound, which
 * keeps the quantiles `bucketQuantile` reports for them.
 */
export function rebucket(
  bounds: readonly number[],
  counts: readonly number[],
  target: readonly number[],
): number[] {
  // The common case: every series in the group reported the same bounds.
  if (bounds.length === target.length && bounds.every((b, i) => b === target[i])) {
    return Array.from({ length: target.length + 1 }, (_, i) => counts[i] ?? 0);
  }
  const out = Array.from({ length: target.length + 1 }, () => 0);
  // The target bucket holding a value: the first whose upper bound is at or above it.
  const holding = (value: number) => {
    const index = target.findIndex((upper) => upper >= value);
    return index === -1 ? target.length : index;
  };
  counts.forEach((count, i) => {
    if (!count) return;
    const upper = bounds[i];
    if (upper === undefined) {
      const last = bounds[bounds.length - 1];
      const index = last === undefined ? target.length : target.findIndex((t) => t > last);
      out[index === -1 ? target.length : index] += count;
      return;
    }
    const lower = i === 0 ? Math.min(0, upper) : (bounds[i - 1] ?? 0);
    if (upper <= lower) {
      out[holding(upper)] += count;
      return;
    }
    for (let j = holding(lower); j < out.length; j++) {
      const top = target[j] ?? Infinity;
      // The first target bucket has no lower edge, like a quantile's.
      const bottom = j === 0 ? -Infinity : (target[j - 1] ?? 0);
      const overlap = Math.min(upper, top) - Math.max(lower, bottom);
      if (overlap > 0) out[j] += (count * overlap) / (upper - lower);
      if (top >= upper) break;
    }
  });
  return out;
}

/** Adds intervals that share a time and group into one, on `layout`'s bounds. */
function combine(intervals: HistogramInterval[], layout: BucketLayout): HistogramInterval[] {
  const byKey = new Map<string, HistogramInterval>();
  for (const interval of intervals) {
    const key = `${interval.ts}\u0000${JSON.stringify(interval.labels)}`;
    const counts = rebucket(interval.bounds, interval.counts, layout.bounds);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...interval, bounds: layout.bounds, counts });
      continue;
    }
    current.counts = current.counts.map((c, i) => c + (counts[i] ?? 0));
    current.count += interval.count;
    current.sum += interval.sum;
    current.rate += interval.rate;
  }
  return [...byKey.values()];
}

function mergeNote(layouts: BucketLayout[]): BucketMergeNote | undefined {
  const merged = layouts.filter((l) => l.merge !== undefined);
  if (merged.length === 0) return undefined;
  return {
    merge: merged.some((l) => l.merge === "interpolated") ? "interpolated" : "shared",
    layouts: Math.max(...merged.map((l) => l.layouts)),
  };
}

/**
 * One line per group. Each group gets one set of bounds for the whole range,
 * chosen from every layout its series used, so a percentile's resolution
 * doesn't change from one interval to the next.
 */
export function histogramSeries(
  intervals: HistogramInterval[],
  grid: number[],
  aggregation: MetricAggregation,
): { series: MetricSeries[]; merged?: BucketMergeNote } {
  const groups = new Map<string, HistogramInterval[]>();
  for (const interval of intervals) {
    const id = JSON.stringify(interval.labels);
    const group = groups.get(id);
    if (group) group.push(interval);
    else groups.set(id, [interval]);
  }
  const indexOf = new Map(grid.map((t, i) => [t, i]));
  const layouts: BucketLayout[] = [];
  const series: MetricSeries[] = [];
  for (const group of groups.values()) {
    const layout = bucketLayout(group.map((i) => i.bounds));
    layouts.push(layout);
    let entry: MetricSeries | undefined;
    for (const interval of combine(group, layout)) {
      const index = indexOf.get(interval.ts);
      if (index === undefined) continue;
      const value = reduce(interval, aggregation);
      if (value === null || !Number.isFinite(value)) continue;
      entry ??= { labels: interval.labels, values: grid.map(() => null) };
      entry.values[index] = value;
    }
    if (entry) series.push(entry);
  }
  return { series, merged: mergeNote(layouts) };
}

/**
 * Bucket counts over time, every group added together, on one set of bounds
 * chosen the same way as for a group's line.
 */
export function histogramHeatmap(intervals: HistogramInterval[], grid: number[]): MetricHeatmap {
  const layout = bucketLayout(intervals.map((i) => i.bounds));
  const indexOf = new Map(grid.map((t, i) => [t, i]));
  const counts = grid.map(() => Array.from({ length: layout.bounds.length + 1 }, () => 0));
  for (const interval of intervals) {
    const row = counts[indexOf.get(interval.ts) ?? -1];
    if (!row) continue;
    rebucket(interval.bounds, interval.counts, layout.bounds).forEach((c, i) => {
      row[i] = (row[i] ?? 0) + c;
    });
  }
  return { bounds: layout.bounds, counts, merged: mergeNote([layout]) };
}

/** The lowest and highest bucket index used, per side; null when none is. */
export interface ExponentialSpan {
  positive: [number, number] | null;
  negative: [number, number] | null;
}

// The most buckets a side of an exponential histogram expands to, as
// Prometheus caps native histograms.
const MAX_EXPONENTIAL_BUCKETS = 160;

/**
 * Lowers exponential histograms' scale until each side spans at most `max`
 * buckets. Series that each saw a narrow range keep a high scale, and one
 * span over all of them could otherwise cover millions of buckets. At scale
 * s - shift, index i becomes floor(i / 2^shift), as the SQL merges scales.
 */
export function fitExponentialScale<
  H extends { positive: Record<string, number>; negative: Record<string, number> },
>(histograms: H[], max = MAX_EXPONENTIAL_BUCKETS): { shift: number; histograms: H[] } {
  const span = exponentialSpan(histograms);
  const width = (side: [number, number] | null, shift: number) =>
    side ? Math.floor(side[1] / 2 ** shift) - Math.floor(side[0] / 2 ** shift) + 1 : 0;
  let shift = 0;
  while (Math.max(width(span.positive, shift), width(span.negative, shift)) > max) shift++;
  if (shift === 0) return { shift, histograms };
  const merge = (counts: Record<string, number>) => {
    const merged: Record<string, number> = {};
    for (const [index, count] of Object.entries(counts)) {
      const key = String(Math.floor(Number(index) / 2 ** shift));
      merged[key] = (merged[key] ?? 0) + count;
    }
    return merged;
  };
  return {
    shift,
    histograms: histograms.map((h) => ({
      ...h,
      positive: merge(h.positive),
      negative: merge(h.negative),
    })),
  };
}

/** The span covering every given histogram's buckets. */
export function exponentialSpan(
  histograms: { positive: Record<string, number>; negative: Record<string, number> }[],
): ExponentialSpan {
  // A running min and max: spreading every index into Math.min overflows the
  // stack on large scans.
  const extent = (side: "positive" | "negative"): [number, number] | null => {
    let span: [number, number] | null = null;
    for (const histogram of histograms) {
      for (const [key, count] of Object.entries(histogram[side])) {
        if (!(count > 0)) continue;
        const index = Number(key);
        span = span ? [Math.min(span[0], index), Math.max(span[1], index)] : [index, index];
      }
    }
    return span;
  };
  return { positive: extent("positive"), negative: extent("negative") };
}

/**
 * Bucket counts of an exponential histogram, all at one scale, as explicit
 * bounds and counts. At scale s, positive bucket i holds (base^i, base^(i+1)]
 * with base = 2^(2^-s); negative bucket i mirrors it below zero, and the zero
 * bucket holds values at zero. Indexes come as map keys so series at the same
 * scale line up. Every index in `span` gets a bucket, empty if unused, so
 * histograms converted with the same span share their bounds exactly.
 */
export function exponentialBuckets(
  scale: number,
  positive: Record<string, number>,
  negative: Record<string, number>,
  zero: number,
  span: ExponentialSpan,
): { bounds: number[]; counts: number[] } {
  const base = 2 ** (2 ** -scale);
  const bounds: number[] = [];
  const counts: number[] = [];
  if (span.negative) {
    const [low, high] = span.negative;
    // Everything below the most negative bucket: nothing.
    bounds.push(-(base ** (high + 1)));
    counts.push(0);
    for (let i = high; i >= low; i--) {
      bounds.push(-(base ** i));
      counts.push(negative[String(i)] ?? 0);
    }
    // Between the least negative bucket and zero: nothing. Without it, the
    // zero count would sit in a bucket reaching down to that bucket's bound,
    // and percentiles among zeros would read below zero.
    bounds.push(0);
    counts.push(0);
  }
  // The zero bucket, [0, 0], when the side before it ends at zero too.
  bounds.push(0);
  counts.push(zero);
  if (span.positive) {
    const [low, high] = span.positive;
    // Between zero and the first bucket: nothing.
    bounds.push(base ** low);
    counts.push(0);
    for (let i = low; i <= high; i++) {
      bounds.push(base ** (i + 1));
      counts.push(positive[String(i)] ?? 0);
    }
  }
  // Above the last bound: nothing.
  counts.push(0);
  return { bounds, counts };
}
