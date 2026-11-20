import type { MetricAggregation, MetricKind, MetricType } from "./schemas";

/** A metric as the metric switcher lists it: no counts, so it's cheap over any range. */
export interface MetricNameEntry {
  name: string;
  type: MetricType;
  isMonotonic: boolean;
}

/** What describes a metric, the same for every point of it. */
export interface MetricMetadata {
  type: MetricType;
  unit: string;
  description: string;
  isMonotonic: boolean;
  /** OTLP AggregationTemporality: 1 delta, 2 cumulative, 0 for gauges and summaries. */
  temporality: number;
}

export interface MetricCatalogEntry extends MetricMetadata {
  name: string;
  points: number;
  /** The newest data point, ClickHouse DateTime in UTC. */
  lastSeen: string;
}

export interface MetricSeries {
  /** One value per group-by key, in the order the keys were given. */
  labels: string[];
  /** One value per bucket; null where the series reported nothing. */
  values: (number | null)[];
}

export interface MetricSeriesResult {
  stepSeconds: number;
  /** Bucket start times, ISO 8601. */
  buckets: string[];
  /** The top series by their largest value, most first. */
  series: MetricSeries[];
  /** Every series the group-by produced, including those cut from `series`. */
  totalSeries: number;
  /** Histograms asked for a heatmap: bucket counts over time, all series added together. */
  heatmap?: MetricHeatmap;
  /** Set when the metric's export interval, not the range, set the step. */
  stepFromExport?: boolean;
  /** Summaries only: the most series one line is the highest of. */
  highestOf?: number;
  /** Histograms only: set when a line combines series with different bucket bounds. */
  merged?: BucketMergeNote;
}

/**
 * How series with different bucket bounds were put on one set of bounds:
 * `shared` when one layout's bounds appear in all the others, so counts merge
 * exactly at those bounds; `interpolated` otherwise, spreading each bucket's
 * count over the union of bounds in proportion to how much of it each new
 * bucket covers.
 */
export type BucketMerge = "shared" | "interpolated";

export interface BucketMergeNote {
  merge: BucketMerge;
  /** The most bucket layouts combined into one line or heatmap. */
  layouts: number;
}

/** A sample measurement that links a data point to the trace it came from. */
export interface MetricExemplar {
  /** Start of the interval it falls in, seconds since the epoch. */
  ts: number;
  /** When it was measured, ClickHouse DateTime in UTC. */
  time: string;
  value: number;
  traceId: string;
  spanId: string;
  /** The group-by values of its series, in the order the keys were given. */
  labels: string[];
}

export interface MetricHeatmap {
  /** Upper bucket bounds; one more bucket holds everything above the last. */
  bounds: number[];
  /** Per time bucket, the observations in each histogram bucket. */
  counts: number[][];
  /** Set when the heatmap combines series with different bucket bounds. */
  merged?: BucketMergeNote;
}

/**
 * How a metric is read, which decides the aggregations it offers. A sum
 * splits in two: a monotonic one is a counter, read as a rate, while a
 * non-monotonic one (an UpDownCounter) is a level, read like a gauge.
 */
export function metricKind(type: MetricType, isMonotonic: boolean): MetricKind {
  if (type === "sum") return isMonotonic ? "counter" : "updown";
  return type;
}

const AGGREGATIONS: Record<MetricKind, MetricAggregation[]> = {
  gauge: ["avg", "min", "max", "sum"],
  counter: ["rate", "increase"],
  updown: ["sum", "avg", "min", "max"],
  histogram: ["p50", "p95", "p99", "avg", "rate"],
  exponential_histogram: ["p50", "p95", "p99", "avg", "rate"],
  summary: ["p50", "p90", "p95", "p99", "min", "max", "avg", "rate"],
};

/** The quantile each summary aggregation reads; min and max are 0 and 1. */
export const SUMMARY_QUANTILES: Partial<Record<MetricAggregation, number>> = {
  min: 0,
  p50: 0.5,
  p90: 0.9,
  p95: 0.95,
  p99: 0.99,
  max: 1,
};

// p95 reads a latency histogram the way people usually first look at it.
const DEFAULT_AGGREGATION: Partial<Record<MetricKind, MetricAggregation>> = {
  histogram: "p95",
  exponential_histogram: "p95",
};
// A summary reports only the quantiles its SDK was configured with.
const SUMMARY_PREFERENCE: MetricAggregation[] = ["p95", "p99", "p90", "p50", "max", "avg"];

/** The aggregations a metric kind supports, in display order. */
export function aggregationsFor(kind: MetricKind): MetricAggregation[] {
  return AGGREGATIONS[kind];
}

/**
 * The aggregations a summary offers: the quantiles it reports that have a
 * name here, then avg and rate, which come from Count and Sum.
 */
export function summaryAggregations(reported: number[]): MetricAggregation[] {
  return AGGREGATIONS.summary.filter((aggregation) => {
    const quantile = SUMMARY_QUANTILES[aggregation];
    return quantile === undefined || reported.includes(quantile);
  });
}

export function defaultAggregation(
  kind: MetricKind,
  available: MetricAggregation[],
): MetricAggregation | null {
  if (kind === "summary") {
    return SUMMARY_PREFERENCE.find((aggregation) => available.includes(aggregation)) ?? null;
  }
  return DEFAULT_AGGREGATION[kind] ?? available[0] ?? null;
}

/** A histogram's or summary's rate counts observations, so it drops the metric's unit. */
export function valueUnit(
  kind: MetricKind | null,
  aggregation: MetricAggregation | null,
  unit: string,
) {
  return (isHistogramKind(kind) || kind === "summary") && aggregation === "rate" ? "" : unit;
}

/** Both histogram kinds chart the same way, with a heatmap view. */
export function isHistogramKind(kind: MetricKind | null | undefined): boolean {
  return kind === "histogram" || kind === "exponential_histogram";
}

/** The most metrics the catalog and the metric switcher list, first by name. */
export const METRIC_LIST_LIMIT = 2000;
