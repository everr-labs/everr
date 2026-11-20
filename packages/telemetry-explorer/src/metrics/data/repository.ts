import { bucketSeconds } from "@everr/ui/lib/bucket";
import { resolveTimeRange, toClickHouseDateTimeSeconds } from "@everr/ui/lib/time-range";
import type {
  AttributeFilter,
  AttributeKey,
  AttributeSource,
} from "../../attribute-filter/schemas";
import { ENVIRONMENT_ATTRIBUTE } from "../../filters/ui/dedicated-attributes";
import { validateTableName } from "../../sql/table";
import type { SqlClient } from "../../traces/data/client";
import {
  type GroupByKey,
  type MetricAggregation,
  type MetricAttributeKeysInput,
  type MetricAttributeValuesInput,
  type MetricCatalogInput,
  MetricCatalogInputSchema,
  type MetricMetadataInput,
  MetricMetadataInputSchema,
  type MetricExemplarsInput,
  type MetricExportIntervalInput,
  MetricExportIntervalInputSchema,
  type MetricFilterOptionsInput,
  type MetricSummaryQuantilesInput,
  MetricExemplarsInputSchema,
  type MetricSeriesInput,
  MetricSeriesInputSchema,
  type MetricKind,
  type MetricType,
  MetricTypeSchema,
} from "./schemas";
import {
  exponentialBuckets,
  exponentialSpan,
  type HistogramInterval,
  histogramHeatmap,
  histogramSeries,
} from "./histogram";
import {
  aggregationsFor,
  type MetricCatalogEntry,
  type MetricNameEntry,
  type MetricExemplar,
  type MetricSeries,
  type MetricSeriesResult,
  metricKind,
  SUMMARY_QUANTILES,
} from "./types";

export type MetricsRepositoryLike = {
  catalog(input: MetricCatalogInput): Promise<MetricCatalogEntry[]>;
  /** The metrics in range, name and type only, for the metric switcher. */
  names(input: MetricCatalogInput): Promise<MetricNameEntry[]>;
  /** One metric's catalog entry, or null when it sent nothing in range. */
  metadata(input: MetricMetadataInput): Promise<MetricCatalogEntry | null>;
  series(input: MetricSeriesInput): Promise<MetricSeriesResult>;
  exemplars(input: MetricExemplarsInput): Promise<MetricExemplar[]>;
  attributeKeys(input: MetricAttributeKeysInput): Promise<AttributeKey[]>;
  attributeValues(input: MetricAttributeValuesInput): Promise<string[]>;
  /** Every service that sent a metric in the range, for the shared Service filter. */
  services(input: MetricFilterOptionsInput): Promise<string[]>;
  /** Every `deployment.environment.name` in the range, for the shared Environment filter. */
  environments(input: MetricFilterOptionsInput): Promise<string[]>;
  summaryQuantiles(input: MetricSummaryQuantilesInput): Promise<number[]>;
  exportInterval(input: MetricExportIntervalInput): Promise<number | null>;
};

export type MetricsRepositoryOptions = {
  /** Table per data point type. Defaults to the app's `metrics_*` tables. */
  tables?: Partial<Record<MetricType, string>>;
};

const DEFAULT_TABLES: Record<MetricType, string> = {
  gauge: "metrics_gauge",
  sum: "metrics_sum",
  histogram: "metrics_histogram",
  exponential_histogram: "metrics_exponential_histogram",
  summary: "metrics_summary",
};

// Gauges and summaries have neither column; sums alone say whether they only grow.
const TYPE_COLUMNS: Record<MetricType, { monotonic: string; temporality: string }> = {
  gauge: { monotonic: "false", temporality: "toInt32(0)" },
  sum: { monotonic: "IsMonotonic", temporality: "AggregationTemporality" },
  histogram: { monotonic: "false", temporality: "AggregationTemporality" },
  exponential_histogram: { monotonic: "false", temporality: "AggregationTemporality" },
  summary: { monotonic: "false", temporality: "toInt32(0)" },
};

const ATTRIBUTE_COLUMNS: Partial<Record<AttributeSource, string>> = {
  resource: "ResourceAttributes",
  metric: "Attributes",
};

// Stamped by ingest on every row; the row policy already filters on it.
const HIDDEN_KEYS = ["everr.tenant.id"];

const CATALOG_LIMIT = 2000;
const SERIES_TARGET_BUCKETS = 120;
// SDKs export every 60s by default. A finer step leaves most buckets empty,
// which breaks gauge lines into dots and counter rates into spikes.
const SERIES_MIN_STEP_SECONDS = 60;
const SERIES_TOP_N = 10;
const SERIES_ROW_LIMIT = 200_000;
// One per interval and series keeps the chart readable on long ranges.
const EXEMPLAR_LIMIT = 1000;
const ATTRIBUTE_KEYS_SAMPLE = 10_000;
const ATTRIBUTE_KEYS_LIMIT = 500;
const ATTRIBUTE_VALUES_LIMIT = 100;

// A cumulative series whose start time falls inside the scan began counting
// there, so its first point is all change: a counter deployed mid-range, or
// one that has exported only once. A start time before the scan, or none
// (0), means its first point is a running total from outside the range.
const STARTED_IN_SCAN_SQL = "started >= parseDateTimeBestEffort({fromTs:String})";

interface CounterSource {
  /** The running total or delta that's counted, and whose drop is a restart. */
  value: string;
  /** A second total that restarts with `value`, for avg; `0` when unused. */
  total: string;
  temporality: string;
}

const SUM_SOURCE: CounterSource = {
  value: "Value",
  total: "0",
  temporality: "AggregationTemporality",
};

// Summaries are always cumulative, and their table has no temporality column.
const SUMMARY_SOURCE: CounterSource = { value: "Count", total: "Sum", temporality: "2" };

// How far before the range a counter's or cumulative histogram's previous
// export is looked for, so a series exported every few minutes still has a
// point to measure the range's first change from.
const LOOKBACK_SECONDS = 3600;

// A delta point covers (StartTimeUnix, TimeUnix]. A missing start, or one
// further back than the lookback, says nothing usable about that window, so
// the point is placed at its time.
const DELTA_FROM_SQL = `if(deltaFrom > 0 AND toInt64(t) - toInt64(deltaFrom) BETWEEN 1 AND ${LOOKBACK_SECONDS}, deltaFrom, t)`;

// A change covers (f, t], both in seconds. When that window is longer than a
// step, as for a series exported less often than the chart's step, the change
// is spread over the buckets it spans by how much of each it covers, so each
// bucket's rate is the change over its real duration. Otherwise it lands whole
// in t's bucket, which keeps dense series exactly as exported.
const SPREAD_SQL = "t > f + {step:UInt32}";
const SPREAD_BUCKETS_SQL = `if(${SPREAD_SQL},
    range(toUInt32(intDiv(f, {step:UInt32}) * {step:UInt32}), t, {step:UInt32}),
    [toUInt32(intDiv(t, {step:UInt32}) * {step:UInt32})])`;
const SPREAD_SHARE_SQL = `if(${SPREAD_SQL},
    (toFloat64(least(t, b + {step:UInt32})) - toFloat64(greatest(f, b))) / (toFloat64(t) - toFloat64(f)),
    1)`;

const TIME_WINDOW_SQL =
  "TimeUnix >= parseDateTimeBestEffort({fromTs:String}) AND TimeUnix <= parseDateTimeBestEffort({toTs:String})";

function attributeColumn(source: AttributeSource): string {
  const column = ATTRIBUTE_COLUMNS[source];
  if (!column) throw new Error(`metrics have no ${source} attributes`);
  return column;
}

/** Map-column predicates, with the same meaning as the JSON ones the other
 *  explorers use: "is not" requires the key, "missing" is its absence. */
function attributeClauses(attributes: AttributeFilter[]) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  attributes.forEach((filter, i) => {
    const column = attributeColumn(filter.source);
    const key = `attrKey${i}`;
    const values = `attrVals${i}`;
    const exists = `mapContains(${column}, {${key}:String})`;
    const value = `${column}[{${key}:String}]`;
    switch (filter.op) {
      case "in":
      case "not_in":
        if (filter.values.length === 0) return;
        clauses.push(
          `${exists} AND ${value} ${filter.op === "in" ? "IN" : "NOT IN"} {${values}:Array(String)}`,
        );
        params[values] = filter.values;
        break;
      case "exists":
        clauses.push(exists);
        break;
      case "missing":
        clauses.push(`NOT ${exists}`);
        break;
    }
    params[key] = filter.key;
  });
  return { clauses, params };
}

type CatalogScope = { type: MetricType; clause: string }[];

/**
 * The tables a catalog read covers for the kinds asked for, every table when
 * none. A Counter and an UpDownCounter share the sum table, so asking for one
 * of them adds a clause on IsMonotonic.
 */
function kindScope(kinds: MetricKind[]): CatalogScope {
  if (kinds.length === 0) return MetricTypeSchema.options.map((type) => ({ type, clause: "" }));
  const wanted = new Set(kinds);
  return MetricTypeSchema.options.flatMap((type): CatalogScope => {
    if (type !== "sum") return wanted.has(type) ? [{ type, clause: "" }] : [];
    const counter = wanted.has("counter");
    const updown = wanted.has("updown");
    if (counter && updown) return [{ type, clause: "" }];
    if (counter) return [{ type, clause: "\n    AND IsMonotonic" }];
    if (updown) return [{ type, clause: "\n    AND NOT IsMonotonic" }];
    return [];
  });
}

function baseWhere(input: {
  service: string[];
  attributes: AttributeFilter[];
  metric?: string;
  q?: string;
}) {
  const clauses = [TIME_WINDOW_SQL];
  const params: Record<string, unknown> = {};
  if (input.metric) {
    clauses.push("MetricName = {metric:String}");
    params.metric = input.metric;
  }
  if (input.q) {
    clauses.push("positionCaseInsensitive(MetricName, {q:String}) > 0");
    params.q = input.q;
  }
  if (input.service.length > 0) {
    clauses.push("ServiceName IN {service:Array(String)}");
    params.service = input.service;
  }
  const attrs = attributeClauses(input.attributes);
  clauses.push(...attrs.clauses);
  return { clause: clauses.join("\n    AND "), params: { ...params, ...attrs.params } };
}

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Bucket start times, in seconds, covering `[from, to]` on the step's grid. */
function bucketGrid(from: Date, to: Date, step: number): number[] {
  const first = Math.floor(seconds(from) / step) * step;
  const last = Math.floor(seconds(to) / step) * step;
  const grid: number[] = [];
  for (let t = first; t <= last; t += step) grid.push(t);
  return grid;
}

// Steps a chart may take when the export interval sets it, so buckets stay on
// round clock times.
const CLEAN_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400];

/**
 * The chart's step: about 120 buckets over the range, never under a minute,
 * and never finer than the metric's export interval (`minStep`), which would
 * only leave empty buckets between exports. The interval is rounded up to a
 * clean step, with 10% slack so 61 s of exporter jitter stays at 1 minute.
 */
function seriesStep(from: Date, to: Date, minStep?: number): number {
  const byRange = Math.max(SERIES_MIN_STEP_SECONDS, bucketSeconds(from, to, SERIES_TARGET_BUCKETS));
  if (!minStep) return byRange;
  const byExport =
    CLEAN_STEPS.find((step) => step >= minStep * 0.9) ?? CLEAN_STEPS[CLEAN_STEPS.length - 1] ?? 0;
  return Math.max(byRange, byExport);
}

/** One array element per group-by key, read from the series' attributes. */
function groupLabels(groupBy: GroupByKey[]) {
  const groupParams: Record<string, unknown> = {};
  const labelsSql =
    groupBy.length === 0
      ? "CAST([], 'Array(String)')"
      : `[${groupBy
          .map((g, i) => {
            groupParams[`groupKey${i}`] = g.key;
            return `${attributeColumn(g.source)}[{groupKey${i}:String}]`;
          })
          .join(", ")}]`;
  return { labelsSql, groupParams };
}

/** Per bucket and series: the value the outer query aggregates across series. */
function levelInnerSql(aggregation: MetricAggregation): string {
  switch (aggregation) {
    case "min":
      return "min(Value)";
    case "max":
      return "max(Value)";
    case "sum":
      // A level summed across series: each series counts once, at its latest
      // value in the bucket, however often it reported.
      return "argMax(Value, TimeUnix)";
    case "avg":
    case "rate":
    case "increase":
    case "p50":
    case "p90":
    case "p95":
    case "p99":
      return "avg(Value)";
  }
}

function levelOuterSql(aggregation: MetricAggregation): string {
  return aggregation === "min" || aggregation === "max" || aggregation === "sum"
    ? `${aggregation}(v)`
    : "avg(v)";
}

interface CatalogRowRaw {
  name: string;
  type: string;
  unit: string;
  description: string;
  isMonotonic: boolean | number;
  temporality: number | string;
  services: number | string;
  points: number | string;
  lastSeen: string;
}

interface ExpHistogramRowRaw {
  ts: number | string;
  labels: string[];
  scale: number | string;
  positive: Record<string, number | string>;
  negative: Record<string, number | string>;
  zero: number | string;
  observations: number | string;
  observedSum: number | string;
}

interface HistogramRowRaw {
  ts: number | string;
  labels: string[];
  bounds: (number | string)[];
  bucketCounts: (number | string)[];
  observations: number | string;
  observedSum: number | string;
}

/**
 * Observations per interval and group. Delta points carry an interval's
 * observations already. Cumulative points carry running totals, so each
 * series' interval is its last snapshot minus the one before; a total that
 * dropped, or bounds that changed, mean the series restarted, and the new
 * snapshot is all its observations, as is the first snapshot of a series that
 * started inside the scan. A change spanning more than a step is spread over
 * the buckets it covers (see SPREAD_SQL). Series in one group add up bucket by
 * bucket when their bounds match.
 */
/**
 * The same as `histogramSql` for exponential histograms. Every point is first
 * brought down to the lowest scale in the scan: at scale s - 1 each bucket
 * merges two neighbours at s, so index i becomes floor(i / 2^d). Series and
 * snapshots then share bucket indexes exactly, even when an SDK lowered its
 * scale between exports, and counts subtract and add up per index, the way
 * Prometheus merges native histograms of different resolutions.
 */
function expHistogramSql(table: string, where: string, labelsSql: string, bucketSql: string) {
  const buckets = (offset: string, counts: string) =>
    `mapFromArrays(
        arrayReduce('sumMap',
          [arrayMap(k -> toInt64(floor((${offset} + k) / pow(2, Scale - minScale))), range(length(${counts})))],
          [arrayMap(c -> toFloat64(c), ${counts})]).1,
        arrayReduce('sumMap',
          [arrayMap(k -> toInt64(floor((${offset} + k) / pow(2, Scale - minScale))), range(length(${counts})))],
          [arrayMap(c -> toFloat64(c), ${counts})]).2)`;
  const positiveDelta =
    "mapApply((k, v) -> (k, greatest(v, 0)), mapSubtract(lastPositive, previousPositive))";
  const negativeDelta =
    "mapApply((k, v) -> (k, greatest(v, 0)), mapSubtract(lastNegative, previousNegative))";
  const scaled = (map: string) => `mapApply((k, v) -> (k, v * share), ${map})`;
  return `
WITH (SELECT min(Scale) FROM ${table} WHERE ${where}) AS minScale
SELECT b AS ts, labels, any(minScale) AS scale,
  sumMap(${scaled("positive")}) AS positive, sumMap(${scaled("negative")}) AS negative,
  sum(zero * share) AS zero, sum(count * share) AS observations, sum(total * share) AS observedSum
FROM (
  SELECT b, labels, positive, negative, zero, count, total, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, t,
      if(temporality = 1, ${DELTA_FROM_SQL}, if(restarted, greatest(previousT, lastStart), previousT)) AS f,
      if(temporality = 1, deltaPositive, if(restarted, lastPositive, ${positiveDelta})) AS positive,
      if(temporality = 1, deltaNegative, if(restarted, lastNegative, ${negativeDelta})) AS negative,
      toFloat64(if(temporality = 1, deltaZero, if(restarted, lastZero, lastZero - previousZero))) AS zero,
      toFloat64(if(temporality = 1, deltaCount, if(restarted, lastCount, lastCount - previousCount))) AS count,
      if(temporality = 1, deltaSum, if(restarted, lastSum, lastSum - previousSum)) AS total
    FROM (
      SELECT *, position = 1 OR lastCount < previousCount AS restarted
      FROM (
        SELECT labels, temporality, started, t, lastStart, deltaFrom,
          deltaPositive, deltaNegative, deltaZero, deltaCount, deltaSum,
          lastPositive, lastNegative, lastZero, lastCount, lastSum,
          lagInFrame(lastPositive) OVER w AS previousPositive,
          lagInFrame(lastNegative) OVER w AS previousNegative,
          lagInFrame(lastZero) OVER w AS previousZero,
          lagInFrame(lastCount) OVER w AS previousCount,
          lagInFrame(lastSum) OVER w AS previousSum,
          lagInFrame(t) OVER w AS previousT,
          row_number() OVER w AS position
        FROM (
          SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
            cityHash64(Attributes, ResourceAttributes) AS series,
            any(AggregationTemporality) AS temporality,
            sumMap(positiveBuckets) AS deltaPositive,
            sumMap(negativeBuckets) AS deltaNegative,
            sum(ZeroCount) AS deltaZero,
            sum(Count) AS deltaCount,
            sum(Sum) AS deltaSum,
            argMax(positiveBuckets, TimeUnix) AS lastPositive,
            argMax(negativeBuckets, TimeUnix) AS lastNegative,
            argMax(ZeroCount, TimeUnix) AS lastZero,
            argMax(Count, TimeUnix) AS lastCount,
            argMax(Sum, TimeUnix) AS lastSum,
            min(StartTimeUnix) AS started,
            toUInt32(max(TimeUnix)) AS t,
            toUInt32(argMax(StartTimeUnix, TimeUnix)) AS lastStart,
            toUInt32(min(StartTimeUnix)) AS deltaFrom
          FROM (
            SELECT *,
              ${buckets("PositiveOffset", "PositiveBucketCounts")} AS positiveBuckets,
              ${buckets("NegativeOffset", "NegativeBucketCounts")} AS negativeBuckets
            FROM ${table}
            WHERE ${where}
          )
          GROUP BY bucket, labels, series
        )
        WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )
      WHERE temporality = 1 OR position > 1 OR ${STARTED_IN_SCAN_SQL}
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32}
GROUP BY b, labels
ORDER BY ts
LIMIT ${SERIES_ROW_LIMIT}`;
}

function histogramSql(table: string, where: string, labelsSql: string, bucketSql: string) {
  const asFloats = (array: string) => `arrayMap(x -> toFloat64(x), ${array})`;
  return `
SELECT b AS ts, labels, bounds,
  sumForEach(arrayMap(x -> x * share, counts)) AS bucketCounts,
  sum(count * share) AS observations, sum(total * share) AS observedSum
FROM (
  SELECT b, labels, bounds, counts, count, total, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, bounds, t,
      if(temporality = 1, ${DELTA_FROM_SQL}, if(restarted, greatest(previousT, lastStart), previousT)) AS f,
      if(temporality = 1, ${asFloats("deltaCounts")},
        if(restarted, ${asFloats("lastCounts")},
          arrayMap((a, b) -> greatest(toFloat64(a) - toFloat64(b), 0), lastCounts, previousCounts))) AS counts,
      if(temporality = 1, toFloat64(deltaCount),
        if(restarted, toFloat64(lastCount), toFloat64(lastCount) - toFloat64(previousCount))) AS count,
      if(temporality = 1, deltaSum, if(restarted, lastSum, lastSum - previousSum)) AS total
    FROM (
      SELECT *,
        position = 1
          OR lastCount < previousCount
          OR length(lastCounts) != length(previousCounts) AS restarted
      FROM (
        SELECT labels, temporality, bounds, started, t, lastStart, deltaFrom,
          deltaCounts, deltaCount, deltaSum, lastCounts, lastCount, lastSum,
          lagInFrame(lastCounts) OVER w AS previousCounts,
          lagInFrame(lastCount) OVER w AS previousCount,
          lagInFrame(lastSum) OVER w AS previousSum,
          lagInFrame(t) OVER w AS previousT,
          row_number() OVER w AS position
        FROM (
          SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
            cityHash64(Attributes, ResourceAttributes) AS series,
            any(AggregationTemporality) AS temporality,
            argMax(ExplicitBounds, TimeUnix) AS bounds,
            sumForEach(BucketCounts) AS deltaCounts,
            sum(Count) AS deltaCount,
            sum(Sum) AS deltaSum,
            argMax(BucketCounts, TimeUnix) AS lastCounts,
            argMax(Count, TimeUnix) AS lastCount,
            argMax(Sum, TimeUnix) AS lastSum,
            min(StartTimeUnix) AS started,
            toUInt32(max(TimeUnix)) AS t,
            toUInt32(argMax(StartTimeUnix, TimeUnix)) AS lastStart,
            toUInt32(min(StartTimeUnix)) AS deltaFrom
          FROM ${table}
          WHERE ${where}
          GROUP BY bucket, labels, series
        )
        WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )
      WHERE temporality = 1 OR position > 1 OR ${STARTED_IN_SCAN_SQL}
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32}
GROUP BY b, labels, bounds
ORDER BY ts
LIMIT ${SERIES_ROW_LIMIT}`;
}

interface SeriesRowRaw {
  ts: number | string;
  labels: string[];
  value: number | string | null;
}

export class MetricsRepository implements MetricsRepositoryLike {
  private readonly tables: Record<MetricType, string>;

  constructor(
    private readonly client: SqlClient,
    options: MetricsRepositoryOptions = {},
  ) {
    this.tables = { ...DEFAULT_TABLES, ...options.tables };
    for (const table of Object.values(this.tables)) validateTableName(table);
  }

  async catalog(raw: MetricCatalogInput): Promise<MetricCatalogEntry[]> {
    const input = MetricCatalogInputSchema.parse(raw);
    return this.catalogEntries(input, kindScope(input.kinds));
  }

  async metadata(raw: MetricMetadataInput): Promise<MetricCatalogEntry | null> {
    const input = MetricMetadataInputSchema.parse(raw);
    const types = input.type ? [input.type] : MetricTypeSchema.options;
    const entries = await this.catalogEntries(
      input,
      types.map((type) => ({ type, clause: "" })),
    );
    return entries[0] ?? null;
  }

  private async catalogEntries(
    input: {
      timeRange: MetricCatalogInput["timeRange"];
      service: string[];
      attributes: AttributeFilter[];
      q?: string;
      metric?: string;
    },
    scope: CatalogScope,
  ): Promise<MetricCatalogEntry[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);

    const parts = scope.map(
      ({ type, clause }) => `
  SELECT MetricName, '${type}' AS type, MetricUnit, MetricDescription, ServiceName, TimeUnix,
    ${TYPE_COLUMNS[type].monotonic} AS monotonic,
    ${TYPE_COLUMNS[type].temporality} AS temporality
  FROM ${this.tables[type]}
  WHERE ${where.clause}${clause}`,
    );

    const sql = `
SELECT
  MetricName AS name,
  type,
  anyIf(MetricUnit, MetricUnit != '') AS unit,
  anyIf(MetricDescription, MetricDescription != '') AS description,
  max(monotonic) AS isMonotonic,
  max(temporality) AS temporality,
  uniqExact(ServiceName) AS services,
  count() AS points,
  toString(max(TimeUnix)) AS lastSeen
FROM (${parts.join("\n  UNION ALL")}
)
GROUP BY name, type
ORDER BY name, type
LIMIT ${CATALOG_LIMIT}`;

    const rows = await this.client.execute<CatalogRowRaw>(sql, {
      ...where.params,
      fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
    });

    return rows.map((row) => ({
      name: row.name,
      type: MetricTypeSchema.parse(row.type),
      unit: row.unit,
      description: row.description,
      isMonotonic: Boolean(toNumber(row.isMonotonic)),
      temporality: toNumber(row.temporality),
      services: toNumber(row.services),
      points: toNumber(row.points),
      lastSeen: row.lastSeen,
    }));
  }

  async names(raw: MetricCatalogInput): Promise<MetricNameEntry[]> {
    const input = MetricCatalogInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    // DISTINCT over the sort key's columns, without the catalog's counts:
    // a few hundred milliseconds over 30 days where the catalog takes seconds.
    const parts = kindScope(input.kinds).map(
      ({ type, clause }) => `
  SELECT DISTINCT MetricName AS name, '${type}' AS type, ${TYPE_COLUMNS[type].monotonic} AS isMonotonic
  FROM ${this.tables[type]}
  WHERE ${where.clause}${clause}`,
    );
    const rows = await this.client.execute<{
      name: string;
      type: string;
      isMonotonic: boolean | number;
    }>(
      `
SELECT name, type, max(isMonotonic) AS isMonotonic
FROM (${parts.join("\n  UNION ALL")}
)
GROUP BY name, type
ORDER BY name, type
LIMIT ${CATALOG_LIMIT}`,
      {
        ...where.params,
        fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
        toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      },
    );
    return rows.map((row) => ({
      name: row.name,
      type: MetricTypeSchema.parse(row.type),
      isMonotonic: Boolean(toNumber(row.isMonotonic)),
    }));
  }

  async series(raw: MetricSeriesInput): Promise<MetricSeriesResult> {
    const result = await this.chart(raw);
    const { fromDate, toDate } = resolveTimeRange(raw.timeRange);
    return result.stepSeconds > seriesStep(fromDate, toDate)
      ? { ...result, stepFromExport: true }
      : result;
  }

  /**
   * How often the metric is exported: the median time between a series'
   * consecutive points, then the median across series, so one slow or
   * irregular exporter doesn't set it for all. Null with fewer than two
   * points in any series.
   */
  async exportInterval(raw: MetricExportIntervalInput): Promise<number | null> {
    const input = MetricExportIntervalInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    const rows = await this.client.execute<{ interval: number | string | null }>(
      `
SELECT if(count() = 0, NULL, quantileExact(0.5)(gap)) AS interval
FROM (
  SELECT quantileExact(0.5)(t - previous) AS gap
  FROM (
    SELECT series, t,
      lagInFrame(t) OVER (PARTITION BY series ORDER BY t ROWS BETWEEN 1 PRECEDING AND CURRENT ROW) AS previous
    FROM (
      SELECT cityHash64(Attributes, ResourceAttributes) AS series, toInt64(toUInt32(TimeUnix)) AS t
      FROM ${this.tables[input.type]}
      WHERE ${where.clause}
    )
  )
  WHERE previous > 0 AND t > previous
  GROUP BY series
)`,
      {
        ...where.params,
        fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
        toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      },
    );
    const interval = rows[0]?.interval;
    return interval === null || interval === undefined ? null : toNumber(interval);
  }

  private async chart(raw: MetricSeriesInput): Promise<MetricSeriesResult> {
    const input = MetricSeriesInputSchema.parse(raw);
    const kind = metricKind(
      input.type,
      input.aggregation === "rate" || input.aggregation === "increase",
    );
    if (!aggregationsFor(kind).includes(input.aggregation)) {
      throw new Error(`${input.aggregation} does not apply to ${input.type} metrics`);
    }
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const step = seriesStep(fromDate, toDate, input.minStep);
    const grid = bucketGrid(fromDate, toDate, step);
    const table = this.tables[input.type];
    const where = baseWhere(input);
    const { labelsSql, groupParams } = groupLabels(input.groupBy);
    const bucketSql = "toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND)";
    const isExponential = input.type === "exponential_histogram";
    const isHistogram = input.type === "histogram" || isExponential;
    const isCounter =
      !isHistogram && (input.aggregation === "rate" || input.aggregation === "increase");
    const isSummaryTotal =
      input.type === "summary" && (input.aggregation === "rate" || input.aggregation === "avg");

    // A counter's or cumulative histogram's first bucket needs the export
    // before it to measure a change, so the scan starts early enough to find
    // one for a series exported every few minutes. Buckets before the range
    // are dropped after.
    const lookback = Math.max(step, LOOKBACK_SECONDS);
    const scanFrom =
      isCounter || isHistogram || isSummaryTotal ? new Date((grid[0] - lookback) * 1000) : fromDate;
    const params = {
      ...where.params,
      ...groupParams,
      fromTs: toClickHouseDateTimeSeconds(scanFrom, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      gridStart: grid[0],
      step,
    };

    if (isExponential) {
      const rows = await this.client.execute<ExpHistogramRowRaw>(
        expHistogramSql(table, where.clause, labelsSql, bucketSql),
        params,
      );
      const numbers = (map: Record<string, number | string>) =>
        Object.fromEntries(Object.entries(map).map(([k, v]) => [k, toNumber(v)]));
      const decoded = rows.map((row) => ({
        row,
        positive: numbers(row.positive),
        negative: numbers(row.negative),
      }));
      // One span for every row keeps every interval on the same bounds.
      const span = exponentialSpan(decoded);
      const intervals = decoded.map(({ row, positive, negative }): HistogramInterval => ({
        ts: toNumber(row.ts),
        labels: row.labels,
        ...exponentialBuckets(toNumber(row.scale), positive, negative, toNumber(row.zero), span),
        count: toNumber(row.observations),
        sum: toNumber(row.observedSum),
      }));
      const { series, merged } = histogramSeries(intervals, grid, step, input.aggregation);
      return {
        ...rankSeries(series, grid, step),
        heatmap: histogramHeatmap(intervals, grid),
        merged,
      };
    }

    if (isHistogram) {
      const rows = await this.client.execute<HistogramRowRaw>(
        histogramSql(table, where.clause, labelsSql, bucketSql),
        params,
      );
      const intervals = rows.map((row): HistogramInterval => ({
        ts: toNumber(row.ts),
        labels: row.labels,
        bounds: row.bounds.map(toNumber),
        counts: row.bucketCounts.map(toNumber),
        count: toNumber(row.observations),
        sum: toNumber(row.observedSum),
      }));
      const { series, merged } = histogramSeries(intervals, grid, step, input.aggregation);
      return {
        ...rankSeries(series, grid, step),
        heatmap: histogramHeatmap(intervals, grid),
        merged,
      };
    }

    if (input.type === "summary") {
      const quantile = SUMMARY_QUANTILES[input.aggregation];
      if (quantile === undefined) {
        const rows = await this.client.execute<SeriesRowRaw>(
          this.counterSql(
            table,
            where.clause,
            labelsSql,
            bucketSql,
            input.aggregation,
            SUMMARY_SOURCE,
          ),
          params,
        );
        return assembleSeries(rows, grid, step);
      }
      const rows = await this.client.execute<SeriesRowRaw & { seriesCount: number | string }>(
        this.summaryQuantileSql(table, where.clause, labelsSql, bucketSql),
        { ...params, quantile },
      );
      const most = Math.max(0, ...rows.map((row) => toNumber(row.seriesCount)));
      return { ...assembleSeries(rows, grid, step), ...(most > 1 ? { highestOf: most } : {}) };
    }

    const sql = isCounter
      ? this.counterSql(table, where.clause, labelsSql, bucketSql, input.aggregation)
      : `
SELECT toUInt32(bucket) AS ts, labels, ${levelOuterSql(input.aggregation)} AS value
FROM (
  SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
    cityHash64(Attributes, ResourceAttributes) AS series,
    ${levelInnerSql(input.aggregation)} AS v
  FROM ${table}
  WHERE ${where.clause}
  GROUP BY bucket, labels, series
)
GROUP BY bucket, labels
ORDER BY ts
LIMIT ${SERIES_ROW_LIMIT}`;

    const rows = await this.client.execute<SeriesRowRaw>(sql, params);
    return assembleSeries(rows, grid, step);
  }

  private counterSql(
    table: string,
    where: string,
    labelsSql: string,
    bucketSql: string,
    aggregation: MetricAggregation,
    source: CounterSource = SUM_SOURCE,
  ): string {
    // Delta points carry the change itself. Cumulative points carry a running
    // total, so the change is the difference from the series' previous bucket;
    // a drop means the process restarted and counted up from zero again, since
    // its start time if that's known. A series' first point counts only when
    // the series started in the scan. A change spanning more than a step is
    // spread over the buckets it covers (see SPREAD_SQL). `total` follows the
    // same restarts as the counted value, so avg is total over count.
    const outer =
      aggregation === "avg"
        ? "sum(totalChange * share) / nullIf(sum(change * share), 0)"
        : aggregation === "rate"
          ? "sum(change * share) / {step:UInt32}"
          : "sum(change * share)";
    return `
SELECT b AS ts, labels, ${outer} AS value
FROM (
  SELECT b, labels, change, totalChange, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, t,
      if(temporality = 1, ${DELTA_FROM_SQL},
        if(position = 1 OR last < previous, greatest(previousT, lastStart), previousT)) AS f,
      if(temporality = 1, delta,
        if(position = 1, if(${STARTED_IN_SCAN_SQL}, last, NULL),
          if(last >= previous, last - previous, last))) AS change,
      if(temporality = 1, deltaTotal,
        if(position = 1, if(${STARTED_IN_SCAN_SQL}, lastTotal, NULL),
          if(last >= previous, lastTotal - previousTotal, lastTotal))) AS totalChange
    FROM (
      SELECT labels, temporality, delta, last, deltaTotal, lastTotal, started, t, lastStart, deltaFrom,
        lagInFrame(last) OVER w AS previous,
        lagInFrame(lastTotal) OVER w AS previousTotal,
        lagInFrame(t) OVER w AS previousT,
        row_number() OVER w AS position
      FROM (
        SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
          cityHash64(Attributes, ResourceAttributes) AS series,
          any(${source.temporality}) AS temporality,
          sum(${source.value}) AS delta,
          argMax(${source.value}, TimeUnix) AS last,
          sum(${source.total}) AS deltaTotal,
          argMax(${source.total}, TimeUnix) AS lastTotal,
          min(StartTimeUnix) AS started,
          toUInt32(max(TimeUnix)) AS t,
          toUInt32(argMax(StartTimeUnix, TimeUnix)) AS lastStart,
          toUInt32(min(StartTimeUnix)) AS deltaFrom
        FROM ${table}
        WHERE ${where}
        GROUP BY bucket, labels, series
      )
      WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32}
GROUP BY b, labels
ORDER BY ts
LIMIT ${SERIES_ROW_LIMIT}`;
  }

  /**
   * A summary's quantiles were computed by the SDK over its own window, so
   * they can't be combined across series. Each series' last value per
   * interval is kept, and a group with several series shows the highest:
   * for latency, the slowest instance.
   */
  private summaryQuantileSql(table: string, where: string, labelsSql: string, bucketSql: string) {
    return `
SELECT toUInt32(bucket) AS ts, labels, max(v) AS value, uniqExact(series) AS seriesCount
FROM (
  SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
    cityHash64(Attributes, ResourceAttributes) AS series,
    argMax(ValueAtQuantiles.Value[indexOf(ValueAtQuantiles.Quantile, {quantile:Float64})], TimeUnix) AS v
  FROM ${table}
  WHERE ${where} AND has(ValueAtQuantiles.Quantile, {quantile:Float64})
  GROUP BY bucket, labels, series
)
GROUP BY bucket, labels
ORDER BY ts
LIMIT ${SERIES_ROW_LIMIT}`;
  }

  /**
   * The exemplar with the highest value in each interval and series: for a
   * latency histogram, the slowest request that SDK sampled. Exemplars
   * without a trace can't link anywhere, so they are left out.
   */
  async exemplars(raw: MetricExemplarsInput): Promise<MetricExemplar[]> {
    const input = MetricExemplarsInputSchema.parse(raw);
    if (input.type === "summary") return [];
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const step = seriesStep(fromDate, toDate, input.minStep);
    const where = baseWhere(input);
    const { labelsSql, groupParams } = groupLabels(input.groupBy);
    const sql = `
SELECT
  toUInt32(toStartOfInterval(Exemplars.TimeUnix, INTERVAL {step:UInt32} SECOND)) AS ts,
  toString(Exemplars.TimeUnix) AS time,
  Exemplars.Value AS value,
  Exemplars.TraceId AS traceId,
  Exemplars.SpanId AS spanId,
  ${labelsSql} AS labels
FROM ${this.tables[input.type]}
ARRAY JOIN Exemplars
WHERE ${where.clause}
  AND Exemplars.TraceId != ''
  AND Exemplars.TimeUnix >= parseDateTimeBestEffort({fromTs:String})
  AND Exemplars.TimeUnix <= parseDateTimeBestEffort({toTs:String})
ORDER BY value DESC
LIMIT 1 BY ts, labels, cityHash64(Attributes, ResourceAttributes)
LIMIT ${EXEMPLAR_LIMIT}`;
    const rows = await this.client.execute<{
      ts: number | string;
      time: string;
      value: number | string;
      traceId: string;
      spanId: string;
      labels: string[];
    }>(sql, {
      ...where.params,
      ...groupParams,
      fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      step,
    });
    return rows.map((row) => ({
      ts: toNumber(row.ts),
      time: row.time,
      value: toNumber(row.value),
      traceId: row.traceId,
      spanId: row.spanId,
      labels: row.labels,
    }));
  }

  async attributeKeys(input: MetricAttributeKeysInput): Promise<AttributeKey[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const sql = `
SELECT DISTINCT pair.1 AS source, pair.2 AS key
FROM (
  SELECT arrayJoin(arrayConcat(
    arrayMap(k -> ('metric', toString(k)), mapKeys(Attributes)),
    arrayMap(k -> ('resource', toString(k)), mapKeys(ResourceAttributes))
  )) AS pair
  FROM (
    SELECT Attributes, ResourceAttributes
    FROM ${this.tables[input.type]}
    WHERE ${TIME_WINDOW_SQL} AND MetricName = {metric:String}
    LIMIT ${ATTRIBUTE_KEYS_SAMPLE}
  )
)
WHERE key NOT IN {hidden:Array(String)}
ORDER BY source, key
LIMIT ${ATTRIBUTE_KEYS_LIMIT}`;
    const rows = await this.client.execute<{ source: AttributeSource; key: string }>(sql, {
      fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      metric: input.metric,
      hidden: HIDDEN_KEYS,
    });
    return rows.map((row) => ({ source: row.source, key: row.key }));
  }

  async attributeValues(input: MetricAttributeValuesInput): Promise<string[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const column = attributeColumn(input.source);
    const search = input.search
      ? `\n    AND positionCaseInsensitive(${column}[{key:String}], {search:String}) > 0`
      : "";
    const sql = `
SELECT ${column}[{key:String}] AS value
FROM ${this.tables[input.type]}
WHERE ${TIME_WINDOW_SQL}
    AND MetricName = {metric:String}
    AND mapContains(${column}, {key:String})${search}
GROUP BY value
ORDER BY count() DESC
LIMIT ${ATTRIBUTE_VALUES_LIMIT}`;
    const rows = await this.client.execute<{ value: string }>(sql, {
      fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
      metric: input.metric,
      key: input.key,
      ...(input.search ? { search: input.search } : {}),
    });
    return rows.map((row) => row.value);
  }

  async services(input: MetricFilterOptionsInput): Promise<string[]> {
    // ServiceName leads each table's sort key after the tenant, so this reads
    // little beyond the time column.
    return this.distinctAcrossTables(input, "ServiceName");
  }

  async environments(input: MetricFilterOptionsInput): Promise<string[]> {
    return this.distinctAcrossTables(input, `ResourceAttributes['${ENVIRONMENT_ATTRIBUTE.key}']`);
  }

  private async distinctAcrossTables(
    input: MetricFilterOptionsInput,
    column: string,
  ): Promise<string[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const parts = MetricTypeSchema.options.map(
      (type) =>
        `SELECT DISTINCT ${column} AS value FROM ${this.tables[type]} WHERE ${TIME_WINDOW_SQL}`,
    );
    const sql = `
SELECT DISTINCT value
FROM (${parts.join("\n  UNION ALL ")})
WHERE value != ''
ORDER BY value
LIMIT ${ATTRIBUTE_VALUES_LIMIT}`;
    const rows = await this.client.execute<{ value: string }>(sql, {
      fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
      toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
    });
    return rows.map((row) => row.value);
  }

  /** The quantiles a summary reports, so the explorer offers only those. */
  async summaryQuantiles(input: MetricSummaryQuantilesInput): Promise<number[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const rows = await this.client.execute<{ quantile: number | string }>(
      `
SELECT DISTINCT arrayJoin(ValueAtQuantiles.Quantile) AS quantile
FROM ${this.tables.summary}
WHERE ${TIME_WINDOW_SQL} AND MetricName = {metric:String}
ORDER BY quantile
LIMIT 50`,
      {
        fromTs: toClickHouseDateTimeSeconds(fromDate, "floor"),
        toTs: toClickHouseDateTimeSeconds(toDate, "ceil"),
        metric: input.metric,
      },
    );
    return rows.map((row) => toNumber(row.quantile));
  }
}

/** Lines the rows up on the bucket grid. */
function assembleSeries(rows: SeriesRowRaw[], grid: number[], step: number): MetricSeriesResult {
  const indexOf = new Map(grid.map((t, i) => [t, i]));
  const byLabels = new Map<string, MetricSeries>();
  for (const row of rows) {
    const index = indexOf.get(toNumber(row.ts));
    if (index === undefined || row.value === null) continue;
    const value = toNumber(row.value);
    if (!Number.isFinite(value)) continue;
    const id = JSON.stringify(row.labels);
    let entry = byLabels.get(id);
    if (!entry) {
      entry = { labels: row.labels, values: grid.map(() => null) };
      byLabels.set(id, entry);
    }
    entry.values[index] = value;
  }
  return rankSeries([...byLabels.values()], grid, step);
}

/** Keeps the series with the largest values, so one high-cardinality key
 *  can't flood the chart. */
function rankSeries(series: MetricSeries[], grid: number[], step: number): MetricSeriesResult {
  const peak = (s: MetricSeries) =>
    s.values.reduce<number>((max, v) => (v !== null && v > max ? v : max), -Infinity);
  const ranked = series
    .map((s) => ({ s, peak: peak(s) }))
    .sort((a, b) => b.peak - a.peak)
    .map(({ s }) => s);
  return {
    stepSeconds: step,
    buckets: grid.map((t) => new Date(t * 1000).toISOString()),
    series: ranked.slice(0, SERIES_TOP_N),
    totalSeries: ranked.length,
  };
}
