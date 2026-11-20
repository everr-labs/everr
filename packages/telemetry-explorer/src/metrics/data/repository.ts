import { bucketSeconds, snapToNiceStep } from "@everr/ui/lib/bucket";
import { resolveTimeRange, toClickHouseDateTimeSeconds } from "@everr/ui/lib/time-range";
import type {
  AttributeFilter,
  AttributeKey,
  AttributeSource,
} from "../../attribute-filter/schemas";
import { ATTRIBUTE_KEY_PER_SOURCE_LIMIT } from "../../attribute-filter/sql/keys";
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
  type MetricNamesInput,
  MetricNamesInputSchema,
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
  MetricSummaryQuantilesInputSchema,
  type MetricKind,
  MetricKindSchema,
  type MetricType,
  MetricTypeSchema,
} from "./schemas";
import {
  exponentialBuckets,
  exponentialSpan,
  fitExponentialScale,
  type HistogramInterval,
  histogramHeatmap,
  histogramSeries,
} from "./histogram";
import {
  METRIC_LIST_LIMIT,
  aggregationsFor,
  type MetricCatalogEntry,
  type MetricMetadata,
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
  names(input: MetricNamesInput): Promise<MetricNameEntry[]>;
  /** The kinds of metric in range, for the catalog's Type filter. */
  kinds(input: MetricNamesInput): Promise<MetricKind[]>;
  /** One metric's unit, description and temporality, or null when it sent nothing in range. */
  metadata(input: MetricMetadataInput): Promise<MetricMetadata | null>;
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

const SERIES_TARGET_BUCKETS = 120;
// SDKs export every 60s by default. A finer step leaves most buckets empty,
// which breaks gauge lines into dots and counter rates into spikes.
const SERIES_MIN_STEP_SECONDS = 60;
const SERIES_TOP_N = 10;
const SERIES_ROW_LIMIT = 200_000;
// Enough rows to find a unit or description that some points leave empty.
const METADATA_SAMPLE_ROWS = 1000;
// The export interval reads the end of the range only: at least this much,
// or a tenth of a long range, so a slow exporter still reports twice.
const EXPORT_INTERVAL_MIN_SCAN_MS = 60 * 60 * 1000;
// One per interval and series keeps the chart readable on long ranges.
const EXEMPLAR_LIMIT = 1000;
const ATTRIBUTE_VALUES_LIMIT = 100;

// A cumulative series whose start time falls inside the scan began counting
// there, so its first point is all change: a counter deployed mid-range, or
// one that has exported only once. A start time before the scan, or none
// (0), means its first point is a running total from outside the range. So
// does a start equal to the point's own time: OpenTelemetry's way of saying
// the start is unknown, which the Prometheus receiver uses.
const STARTED_IN_SCAN_SQL =
  "started >= parseDateTimeBestEffort({fromTs:String}) AND started < firstSeen";

// A cumulative series that reports a new start time restarted, even when its
// new total is already above the old one. A start counts only when it's known,
// before the point's own time (the Prometheus receiver sends a point's own
// time when it doesn't know it, then that time as the start of later points),
// and after the previous export, as a real restart's is: a start that drifts by
// a second between exports is the same start. After exports with no start, one
// strictly after the previous export is a restart too; one at that export's
// time is a receiver filling in a start it didn't know.
const startChangedSql = (start: string, time: string, prevStart: string, prevTime: string) =>
  `(${start} != ${prevStart} AND ${start} > 0 AND ${start} < ${time} AND (
    (${start} >= ${prevTime} AND ${prevStart} > 0 AND ${prevStart} < ${prevTime})
    OR (${prevStart} = 0 AND ${start} > ${prevTime})))`;

// Between a bucket's first point and the previous bucket's last.
const FIRST_START_CHANGED_SQL = startChangedSql(
  "firstStart",
  "toUInt32(firstSeen)",
  "previousStart",
  "previousT",
);

// OpenTelemetry identifies a series by its resource, scope and attributes:
// two libraries reporting the same metric are two series. Not the scope's
// version: receivers report the collector's, and an upgrade isn't a new series.
const SERIES_SQL = "cityHash64(Attributes, ResourceAttributes, ScopeName)";

interface CumulativeBuckets {
  /** The table and filter, or a subquery, the points come from. */
  from: string;
  bucketSql: string;
  labelsSql: string;
  /** The type's own aggregates per bucket, including `temporality`. */
  aggregates: string;
  /** The column that tells delta (1) from cumulative points. */
  temporality: string;
  /** The running total whose drop is a restart. */
  counted: string;
  /** Another sign, per bucket, that it may hold a restart. */
  restartedIf?: string;
  /** More group keys. */
  groupBy?: string;
  /**
   * Columns compared between a point and the one before, by name: `Count`
   * is `curCount` on the point and `prevCount` on the one before.
   */
  compared: Record<string, string>;
  /** A restart between a point and the one before, besides a new start time. */
  drop: string;
  /** Aggregates over the points where the series restarted, of the totals it dropped. */
  lost: string;
}

/**
 * A cumulative series' points per bucket, with what restarts inside each
 * bucket dropped. A bucket's change is its last total minus the one before,
 * plus the total each restart in it dropped, as Prometheus' increase() adds
 * up the change point by point. Pairing every point with the one before needs
 * a sort of every point in range, so it runs only on the buckets that may
 * hold a restart: those whose total fell between two points, or with a start
 * time at or after their first point, which a restart's start inside the
 * bucket is. Elsewhere nothing was dropped. Picking them takes a second,
 * leaner grouping. The bucket's first point is paired with the bucket before
 * by the caller, which also detects restarts there.
 */
function cumulativeBucketsSql(o: CumulativeBuckets) {
  const grouped = `
    SELECT ${o.bucketSql} AS bucket, ${o.labelsSql} AS labels, ${SERIES_SQL} AS series,
      ${o.aggregates},
      argMin(${o.counted}, TimeUnix) AS firstCounted,
      min(StartTimeUnix) AS started,
      min(TimeUnix) AS firstSeen,
      toUInt32(max(TimeUnix)) AS t,
      toUInt32(argMin(StartTimeUnix, TimeUnix)) AS firstStart,
      toUInt32(argMax(StartTimeUnix, TimeUnix)) AS lastStart,
      toUInt32(min(StartTimeUnix)) AS deltaFrom
    FROM ${o.from}
    GROUP BY bucket, labels, series${o.groupBy ? `, ${o.groupBy}` : ""}`;
  const compared = Object.entries({
    Time: "toUInt32(TimeUnix)",
    Start: "toUInt32(StartTimeUnix)",
    ...o.compared,
  });
  const pairs = compared.flatMap(([name], i) => [
    `point.${i + 1} AS cur${name}`,
    `before.${i + 1} AS prev${name}`,
  ]);
  // Each bucket's points are paired in an array rather than a window: a
  // window holds several times as much per point.
  const lost = `
    SELECT bucket, series, ${o.lost}
    FROM (
      SELECT *, prevTime > 0 AND (${o.drop}
        OR ${startChangedSql("curStart", "curTime", "prevStart", "prevTime")}) AS reset
      FROM (
        SELECT bucket, series, ${pairs.join(", ")}
        FROM (
          SELECT bucket, series,
            arraySort(p -> p.1, groupArray((${compared.map(([, expr]) => expr).join(", ")}))) AS points
          FROM (SELECT *, ${o.bucketSql} AS bucket, ${SERIES_SQL} AS series FROM ${o.from})
          WHERE (bucket, series) IN (
          SELECT ${o.bucketSql} AS bucket, ${SERIES_SQL} AS series
          FROM ${o.from}
          GROUP BY bucket, series
          -- A fall shows as increases adding up to more than last minus
          -- first, but deltaSumTimestamp adds them in the order points are
          -- read, which a late batch breaks. A restart's low total also sits
          -- below the bucket's first one, or a total above its last, in any
          -- order; only a dip that stays between the two, as a series that
          -- had just started can make, needs points read in time order.
          HAVING any(${o.temporality}) != 1 AND (
            min(${o.counted}) < argMin(${o.counted}, TimeUnix)
            OR max(${o.counted}) > argMax(${o.counted}, TimeUnix)
            OR deltaSumTimestamp(toFloat64(${o.counted}), toUInt64(toUnixTimestamp64Nano(toDateTime64(TimeUnix, 9))))
              > (toFloat64(argMax(${o.counted}, TimeUnix)) - toFloat64(argMin(${o.counted}, TimeUnix)))
                * (1 + 1e-9) + 1e-9
            OR toUInt32(max(StartTimeUnix)) >= toUInt32(min(TimeUnix))
            ${o.restartedIf ? `OR ${o.restartedIf}` : ""}))
          GROUP BY bucket, series
        )
        -- The first point has none before it: its prevTime is 0.
        ARRAY JOIN points AS point, arrayShiftRight(points, 1) AS before
      )
    )
    GROUP BY bucket, series`;
  return `SELECT * FROM (${grouped}) AS g LEFT JOIN (${lost}) AS r USING (bucket, series)`;
}

// The previous bucket's `last`. A series' first bucket has none: one that
// started in the scan counted up from `zero`, and any other's first point is
// a running total from before, so the bucket counts from that point, `first`.
const previousOr = (last: string, first: string, zero: string) =>
  `lagInFrame(${last}, 1, if(${STARTED_IN_SCAN_SQL}, ${zero}, ${first}))`;
const PREVIOUS_T_SQL = `${previousOr("t", "toUInt32(firstSeen)", "0")} OVER w AS previousT`;

// The buckets that count: a series' first one only when it started in the
// scan, or has more points after its first, a total from before the scan.
const COUNTED_BUCKETS_SQL = `temporality = 1 OR position > 1 OR ${STARTED_IN_SCAN_SQL}
        OR toUInt32(firstSeen) < t`;

// Where a cumulative change starts: the export before, or the known start of
// a restart at the bucket's first point. An unknown one, the first point's own
// time after a reset, is later than the reset itself, so the change would look
// faster than it was. A restart later in the bucket follows exports in it, so
// the change still starts at the export before. A series' first change has no
// export before it, so it starts at its start.
const CUMULATIVE_FROM_SQL = `if(position = 1
    OR (firstReset AND firstStart > 0 AND firstStart < toUInt32(firstSeen)),
  greatest(previousT, firstStart), previousT)`;

/**
 * A level per bucket and series, carried into the buckets after it until the
 * series' next export or for `{carry}` seconds past its last point (one export
 * interval, none when the step is far longer), as Prometheus looks back for a
 * gauge's latest sample. Without
 * it a series whose export lands just past a bucket's end, or that exports
 * less often than the step, drops out of that bucket and the group's sum and
 * average dip. `perSeries` returns bucket, labels, series, t (its last point)
 * and v.
 */
function carriedSql(perSeries: string) {
  return `
SELECT b AS ts, labels, series, v
FROM (
  SELECT *, leadInFrame(toUInt32(bucket)) OVER (
    PARTITION BY series ORDER BY bucket ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING) AS next
  FROM (${perSeries})
)
ARRAY JOIN range(
  toUInt32(bucket),
  least(if(next = 0, 4294967295, next), t + {carry:UInt32} + 1),
  {step:UInt32}) AS b
WHERE b >= {gridStart:UInt32} AND b <= {gridEnd:UInt32}
  -- A step over twice the interval already holds a point of every live
  -- series, and carrying would hold a stopped series through a whole bucket
  -- it never reported in. The range's last bucket is partial, though, so
  -- series that haven't exported in it yet still carry there.
  AND (b = toUInt32(bucket) OR {step:UInt32} <= 2 * {carry:UInt32} OR b + {step:UInt32} > {end:UInt32})`;
}

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

// The time one series' change in a bucket covers, which its rate divides by:
// the step, except in the bucket the range ends in, whose exports measure only
// up to the range's end. There the change covers from its export before, often
// before the bucket starts, to its own. A change with no span, delta points
// without a start, covers the bucket up to the range's end.
const CHANGE_SECONDS_SQL = `multiIf(
    b + {step:UInt32} <= {end:UInt32}, {step:UInt32},
    least(t, b + {step:UInt32}) > if(${SPREAD_SQL}, greatest(f, b), f),
      toFloat64(least(t, b + {step:UInt32})) - toFloat64(if(${SPREAD_SQL}, greatest(f, b), f)),
    greatest(toFloat64({end:UInt32}) - toFloat64(b), 1))`;

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

/**
 * The chart's step: about 120 buckets over the range, never under a minute,
 * and never finer than the metric's export interval (`minStep`), which would
 * only leave empty buckets between exports. The interval is rounded up to a
 * nice step, so buckets stay on round clock times, with 10% slack so 61 s
 * of exporter jitter stays at 1 minute. `fromExport` says the interval won.
 */
function seriesStep(from: Date, to: Date, minStep?: number): { step: number; fromExport: boolean } {
  const byRange = Math.max(SERIES_MIN_STEP_SECONDS, bucketSeconds(from, to, SERIES_TARGET_BUCKETS));
  const byExport = minStep ? snapToNiceStep(minStep * 0.9) : 0;
  return { step: Math.max(byRange, byExport), fromExport: byExport > byRange };
}

/** The scan's time bounds, widened to whole seconds. */
function windowParams(from: Date, to: Date) {
  return {
    fromTs: toClickHouseDateTimeSeconds(from, "floor"),
    toTs: toClickHouseDateTimeSeconds(to, "ceil"),
  };
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
  observedRate: number | string;
  /** How many groups the query produced, before the cap. */
  groups: number | string;
}

interface HistogramRowRaw {
  ts: number | string;
  labels: string[];
  bounds: (number | string)[];
  bucketCounts: (number | string)[];
  observations: number | string;
  observedSum: number | string;
  observedRate: number | string;
  /** How many groups the query produced, before the cap. */
  groups: number | string;
}

/**
 * The same as `histogramSql` for exponential histograms. Every point is first
 * brought down to the lowest scale in the scan: at scale s - 1 each bucket
 * merges two neighbours at s, so index i becomes floor(i / 2^d). Series and
 * snapshots then share bucket indexes exactly, even when an SDK lowered its
 * scale between exports, and counts subtract and add up per index, the way
 * Prometheus merges native histograms of different resolutions.
 */
function expHistogramSql(table: string, where: string, labelsSql: string, bucketSql: string) {
  // sumMap adds counts that land on the same index at the lower scale; its
  // (keys, values) result casts straight to a map.
  const buckets = (offset: string, counts: string) =>
    `CAST(
        arrayReduce('sumMap',
          [arrayMap(k -> toInt64(floor((${offset} + k) / pow(2, Scale - minScale))), range(length(${counts})))],
          [arrayMap(c -> toFloat64(c), ${counts})]),
        'Map(Int64, Float64)')`;
  const clampedDelta = (side: "Positive" | "Negative") =>
    `mapApply((k, v) -> (k, greatest(v, 0)),
      mapAdd(
        mapSubtract(last${side}, if(firstReset, CAST(map(), 'Map(Int64, Float64)'), previous${side})),
        lost${side}))`;
  const scaled = (map: string) => `mapApply((k, v) -> (k, v * share), ${map})`;
  const unlessReset = (previous: string) => `if(firstReset, 0, toFloat64(${previous}))`;
  return `
WITH (SELECT min(Scale) FROM ${table} WHERE ${where}) AS minScale
SELECT b AS ts, labels, any(minScale) AS scale,
  sumMap(${scaled("positive")}) AS positive, sumMap(${scaled("negative")}) AS negative,
  sum(zero * share) AS zero, sum(count * share) AS observations, sum(total * share) AS observedSum,
  sum(count * share / ${CHANGE_SECONDS_SQL}) AS observedRate
FROM (
  SELECT b, labels, t, f, positive, negative, zero, count, total, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, t,
      if(temporality = 1, ${DELTA_FROM_SQL}, ${CUMULATIVE_FROM_SQL}) AS f,
      if(temporality = 1, deltaPositive, ${clampedDelta("Positive")}) AS positive,
      if(temporality = 1, deltaNegative, ${clampedDelta("Negative")}) AS negative,
      if(temporality = 1, toFloat64(deltaZero),
        greatest(toFloat64(lastZero) - ${unlessReset("previousZero")} + lostZero, 0)) AS zero,
      if(temporality = 1, toFloat64(deltaCount),
        toFloat64(lastCount) - ${unlessReset("previousCount")} + lostCount) AS count,
      if(temporality = 1, deltaSum, lastSum - ${unlessReset("previousSum")} + lostSum) AS total
    FROM (
      SELECT *,
        position > 1 AND (firstCounted < previousCount OR ${FIRST_START_CHANGED_SQL}) AS firstReset
      FROM (
        SELECT *,
          ${previousOr("lastPositive", "firstPositive", "CAST(map(), 'Map(Int64, Float64)')")} OVER w AS previousPositive,
          ${previousOr("lastNegative", "firstNegative", "CAST(map(), 'Map(Int64, Float64)')")} OVER w AS previousNegative,
          ${previousOr("lastZero", "firstZero", "0")} OVER w AS previousZero,
          ${previousOr("lastCount", "firstCounted", "0")} OVER w AS previousCount,
          ${previousOr("lastSum", "firstSum", "0")} OVER w AS previousSum,
          ${PREVIOUS_T_SQL},
          lagInFrame(lastStart) OVER w AS previousStart,
          row_number() OVER w AS position
        FROM (${cumulativeBucketsSql({
          from: `(
            SELECT *,
              ${buckets("PositiveOffset", "PositiveBucketCounts")} AS positiveBuckets,
              ${buckets("NegativeOffset", "NegativeBucketCounts")} AS negativeBuckets
            FROM ${table}
            WHERE ${where}
          )`,
          bucketSql,
          labelsSql,
          aggregates: `any(AggregationTemporality) AS temporality,
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
            argMin(positiveBuckets, TimeUnix) AS firstPositive,
            argMin(negativeBuckets, TimeUnix) AS firstNegative,
            argMin(ZeroCount, TimeUnix) AS firstZero,
            argMin(Sum, TimeUnix) AS firstSum`,
          temporality: "AggregationTemporality",
          counted: "Count",
          compared: {
            Positive: "positiveBuckets",
            Negative: "negativeBuckets",
            Zero: "ZeroCount",
            Count: "Count",
            Sum: "Sum",
          },
          drop: "curCount < prevCount",
          lost: `sumMapIf(prevPositive, reset) AS lostPositive,
            sumMapIf(prevNegative, reset) AS lostNegative,
            sumIf(toFloat64(prevZero), reset) AS lostZero,
            sumIf(toFloat64(prevCount), reset) AS lostCount,
            sumIf(prevSum, reset) AS lostSum`,
        })})
        WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )
      WHERE ${COUNTED_BUCKETS_SQL}
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32}
GROUP BY b, labels`;
}

// A histogram's bounds, compared by hash.
const LAYOUT_SQL = "cityHash64(ExplicitBounds)";

/**
 * Observations per interval and group. Delta points carry an interval's
 * observations already. Cumulative points carry running totals, so each
 * series' interval is its last snapshot minus the one before, plus what each
 * restart in it dropped (see cumulativeBucketsSql); a total that dropped, or bounds that
 * changed, mean the series restarted. The first snapshot of a series that
 * started inside the scan is all its observations. A change spanning more than a step is spread over
 * the buckets it covers (see SPREAD_SQL). Series in one group add up bucket by
 * bucket when their bounds match.
 */
function histogramSql(table: string, where: string, labelsSql: string, bucketSql: string) {
  const asFloats = (array: string) => `arrayMap(x -> toFloat64(x), ${array})`;
  const unlessReset = (previous: string) => `if(firstReset, 0, toFloat64(${previous}))`;
  return `
SELECT b AS ts, labels, bounds,
  sumForEach(arrayMap(x -> x * share, counts)) AS bucketCounts,
  sum(count * share) AS observations, sum(total * share) AS observedSum,
  sum(count * share / ${CHANGE_SECONDS_SQL}) AS observedRate
FROM (
  SELECT b, labels, bounds, t, f, counts, count, total, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, bounds, t,
      if(temporality = 1, ${DELTA_FROM_SQL}, ${CUMULATIVE_FROM_SQL}) AS f,
      -- Counts on new bounds can't be compared with the old ones, so a
      -- bucket whose bounds changed counts only its last snapshot.
      if(temporality = 1, ${asFloats("deltaCounts")},
        if(boundsChanged, ${asFloats("lastCounts")},
          arrayMap((a, b, c) -> greatest(toFloat64(a) - toFloat64(b) + toFloat64(c), 0),
            lastCounts,
            arrayResize(if(firstReset, emptyArrayUInt64(), previousCounts), length(lastCounts)),
            arrayResize(lostCounts, length(lastCounts))))) AS counts,
      if(temporality = 1, toFloat64(deltaCount),
        toFloat64(lastCount) - ${unlessReset("previousCount")} + lostCount) AS count,
      if(temporality = 1, deltaSum, lastSum - ${unlessReset("previousSum")} + lostSum) AS total
    FROM (
      SELECT *,
        position > 1 AND (firstCounted < previousCount
          OR firstLayout != previousLayout
          OR ${FIRST_START_CHANGED_SQL}) AS firstReset
      FROM (
        SELECT *,
          ${previousOr("lastCounts", "firstCounts", "emptyArrayUInt64()")} OVER w AS previousCounts,
          lagInFrame(lastLayout) OVER w AS previousLayout,
          ${previousOr("lastCount", "firstCounted", "0")} OVER w AS previousCount,
          ${previousOr("lastSum", "firstSum", "0")} OVER w AS previousSum,
          ${PREVIOUS_T_SQL},
          lagInFrame(lastStart) OVER w AS previousStart,
          row_number() OVER w AS position
        FROM (${cumulativeBucketsSql({
          from: `${table} WHERE ${where}`,
          bucketSql,
          labelsSql,
          // An array kept by argMax costs several times its size per
          // interval and series; its text costs about its size. The bounds
          // are compared by hash.
          aggregates: `any(AggregationTemporality) AS temporality,
            CAST(argMax(toString(ExplicitBounds), TimeUnix), 'Array(Float64)') AS bounds,
            argMin(${LAYOUT_SQL}, TimeUnix) AS firstLayout,
            argMax(${LAYOUT_SQL}, TimeUnix) AS lastLayout,
            min(${LAYOUT_SQL}) != max(${LAYOUT_SQL}) AS boundsChanged,
            sumForEachIf(BucketCounts, AggregationTemporality = 1) AS deltaCounts,
            sum(Count) AS deltaCount,
            sum(Sum) AS deltaSum,
            CAST(argMax(toString(BucketCounts), TimeUnix), 'Array(UInt64)') AS lastCounts,
            argMax(Count, TimeUnix) AS lastCount,
            argMax(Sum, TimeUnix) AS lastSum,
            CAST(argMin(toString(BucketCounts), TimeUnix), 'Array(UInt64)') AS firstCounts,
            argMin(Sum, TimeUnix) AS firstSum`,
          temporality: "AggregationTemporality",
          counted: "Count",
          restartedIf: `min(${LAYOUT_SQL}) != max(${LAYOUT_SQL})`,
          // Delta exports add up within a step only on the same bounds; each
          // layout stays its own row, merged later onto one set of bounds.
          groupBy: `if(AggregationTemporality = 1, ${LAYOUT_SQL}, 0)`,
          compared: {
            Counts: "BucketCounts",
            Layout: LAYOUT_SQL,
            Count: "Count",
            Sum: "Sum",
          },
          drop: "curCount < prevCount OR curLayout != prevLayout",
          lost: `sumForEachIf(prevCounts, reset) AS lostCounts,
            sumIf(toFloat64(prevCount), reset) AS lostCount,
            sumIf(prevSum, reset) AS lostSum`,
        })})
        WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )
      WHERE ${COUNTED_BUCKETS_SQL}
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32}
GROUP BY b, labels, bounds`;
}

/**
 * Caps a histogram's rows by whole groups, the most observed first, so a
 * group-by over thousands of values keeps every interval of the groups it
 * keeps rather than the first intervals of all of them. The lines are ranked
 * by percentile afterwards, which SQL can't compute. `groups` counts every
 * group, kept or not.
 */
function histogramGroupsSql(sql: string) {
  return `
SELECT * EXCEPT (total, position, groupEnd)
FROM (
  SELECT *, max(position) OVER (PARTITION BY labels) AS groupEnd
  FROM (
    SELECT *,
      row_number() OVER (ORDER BY total DESC, labels, ts) AS position,
      uniqExact(labels) OVER () AS groups
    FROM (
      SELECT *, sum(observations) OVER (PARTITION BY labels) AS total
      FROM (${sql})
    )
  )
)
WHERE groupEnd <= ${SERIES_ROW_LIMIT}
ORDER BY position`;
}

interface SeriesRowRaw {
  ts: number | string;
  labels: string[];
  value: number | string;
  /** How many groups the query produced, before the cut to the top ones. */
  groups: number | string;
}

/**
 * Keeps the rows of the SERIES_TOP_N groups with the highest peak, so a
 * group-by over many values sends ten lines, not all of them, and counts the
 * groups that were cut. Rows without a finite value never make a line.
 */
function topSeriesSql(sql: string) {
  return `
SELECT * EXCEPT (peak, rank)
FROM (
  SELECT *, dense_rank() OVER (ORDER BY peak DESC, labels) AS rank
  FROM (
    SELECT *,
      max(value) OVER (PARTITION BY labels) AS peak,
      uniqExact(labels) OVER () AS groups
    FROM (${sql})
    WHERE isFinite(value)
  )
)
WHERE rank <= ${SERIES_TOP_N}
ORDER BY ts`;
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
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);

    const parts = kindScope(input.kinds).map(
      ({ type, clause }) => `
  SELECT MetricName, '${type}' AS type, MetricUnit, MetricDescription, TimeUnix,
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
  count() AS points,
  toString(max(TimeUnix)) AS lastSeen
FROM (${parts.join("\n  UNION ALL")}
)
GROUP BY name, type
ORDER BY name, type
LIMIT ${METRIC_LIST_LIMIT}`;

    const rows = await this.client.execute<CatalogRowRaw>(sql, {
      ...where.params,
      ...windowParams(fromDate, toDate),
    });

    return rows.map((row) => ({
      name: row.name,
      type: MetricTypeSchema.parse(row.type),
      unit: row.unit,
      description: row.description,
      isMonotonic: Boolean(toNumber(row.isMonotonic)),
      temporality: toNumber(row.temporality),
      points: toNumber(row.points),
      lastSeen: row.lastSeen,
    }));
  }

  /**
   * A metric's unit, description and temporality. They're the same on every
   * point, so a sample of rows per table is enough, however long the range.
   */
  async metadata(raw: MetricMetadataInput): Promise<MetricMetadata | null> {
    const input = MetricMetadataInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    const type = input.type;
    const rows = await this.client.execute<
      Omit<CatalogRowRaw, "name" | "type" | "points" | "lastSeen">
    >(
      `
SELECT
  anyIf(MetricUnit, MetricUnit != '') AS unit,
  anyIf(MetricDescription, MetricDescription != '') AS description,
  max(monotonic) AS isMonotonic,
  max(temporality) AS temporality,
  count() AS sampled
FROM (
  SELECT MetricUnit, MetricDescription,
    ${TYPE_COLUMNS[type].monotonic} AS monotonic,
    ${TYPE_COLUMNS[type].temporality} AS temporality
  FROM ${this.tables[type]}
  WHERE ${where.clause}
  LIMIT ${METADATA_SAMPLE_ROWS}
)
HAVING sampled > 0`,
      { ...where.params, ...windowParams(fromDate, toDate) },
    );
    const row = rows[0];
    if (!row) return null;
    return {
      type,
      unit: row.unit,
      description: row.description,
      isMonotonic: Boolean(toNumber(row.isMonotonic)),
      temporality: toNumber(row.temporality),
    };
  }

  async names(raw: MetricNamesInput): Promise<MetricNameEntry[]> {
    const input = MetricNamesInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    // DISTINCT over the sort key's columns, without the catalog's counts:
    // a few hundred milliseconds over 30 days where the catalog takes seconds.
    const parts = MetricTypeSchema.options.map(
      (type) => `
  SELECT DISTINCT MetricName AS name, '${type}' AS type, ${TYPE_COLUMNS[type].monotonic} AS isMonotonic
  FROM ${this.tables[type]}
  WHERE ${where.clause}`,
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
LIMIT ${METRIC_LIST_LIMIT}`,
      {
        ...where.params,
        ...windowParams(fromDate, toDate),
      },
    );
    return rows.map((row) => ({
      name: row.name,
      type: MetricTypeSchema.parse(row.type),
      isMonotonic: Boolean(toNumber(row.isMonotonic)),
    }));
  }

  /** Every kind in range, where `names` stops at its first metrics by name. */
  async kinds(raw: MetricNamesInput): Promise<MetricKind[]> {
    const input = MetricNamesInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    const parts = MetricTypeSchema.options.map(
      (type) => `
  SELECT DISTINCT '${type}' AS type, ${TYPE_COLUMNS[type].monotonic} AS isMonotonic
  FROM ${this.tables[type]}
  WHERE ${where.clause}`,
    );
    const rows = await this.client.execute<{ type: string; isMonotonic: boolean | number }>(
      parts.join("\n  UNION ALL"),
      { ...where.params, ...windowParams(fromDate, toDate) },
    );
    const present = new Set(
      rows.map((row) =>
        metricKind(MetricTypeSchema.parse(row.type), Boolean(toNumber(row.isMonotonic))),
      ),
    );
    return MetricKindSchema.options.filter((kind) => present.has(kind));
  }

  async series(raw: MetricSeriesInput): Promise<MetricSeriesResult> {
    const input = MetricSeriesInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const { step, fromExport } = seriesStep(fromDate, toDate, input.minStep);
    const result = await this.chart(input, fromDate, toDate, step);
    return fromExport ? { ...result, stepFromExport: true } : result;
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
    const span = toDate.getTime() - fromDate.getTime();
    const scanFrom = new Date(
      toDate.getTime() - Math.min(span, Math.max(EXPORT_INTERVAL_MIN_SCAN_MS, span / 10)),
    );
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
      SELECT ${SERIES_SQL} AS series, toInt64(toUInt32(TimeUnix)) AS t
      FROM ${this.tables[input.type]}
      WHERE ${where.clause}
    )
  )
  WHERE previous > 0 AND t > previous
  GROUP BY series
)`,
      {
        ...where.params,
        ...windowParams(scanFrom, toDate),
      },
    );
    const interval = rows[0]?.interval;
    return interval === null || interval === undefined ? null : toNumber(interval);
  }

  private async chart(
    input: ReturnType<typeof MetricSeriesInputSchema.parse>,
    fromDate: Date,
    toDate: Date,
    step: number,
  ): Promise<MetricSeriesResult> {
    const kind = metricKind(
      input.type,
      input.aggregation === "rate" || input.aggregation === "increase",
    );
    if (!aggregationsFor(kind).includes(input.aggregation)) {
      throw new Error(`${input.aggregation} does not apply to ${input.type} metrics`);
    }
    const grid = bucketGrid(fromDate, toDate, step);
    const table = this.tables[input.type];
    const where = baseWhere(input);
    // Only recorded values: a failed scrape writes a point flagged "no
    // recorded value" with a 0, which would read as a counter reset, and one
    // NaN gauge sample would blank its bucket's avg and sum.
    const points = `${where.clause} AND bitAnd(Flags, 1) = 0${
      input.type === "gauge" || input.type === "sum" ? " AND isFinite(Value)" : ""
    }`;
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
    // A level carries for one export interval, so the scan starts that much
    // early to carry one into the first bucket.
    const interval = input.minStep ?? SERIES_MIN_STEP_SECONDS;
    const scanFrom =
      isCounter || isHistogram || isSummaryTotal
        ? new Date((grid[0] - lookback) * 1000)
        : new Date((grid[0] - interval) * 1000);
    const end = Math.ceil(toDate.getTime() / 1000);
    // A rate's last bucket, while shorter than an export interval, holds only
    // the series that already exported in it, so it would read low. It's left
    // out before ranking, unless it's the only one; a histogram's heatmap
    // keeps it, as it counts observations, not a rate.
    const lastBucket = grid[grid.length - 1] ?? grid[0];
    const lastRateBucket =
      input.aggregation === "rate" && grid.length > 1 && end - lastBucket < interval
        ? (grid[grid.length - 2] ?? lastBucket)
        : lastBucket;
    const params = {
      ...where.params,
      ...groupParams,
      ...windowParams(scanFrom, toDate),
      gridStart: grid[0],
      gridEnd: grid[grid.length - 1],
      step,
      carry: interval,
      lastRateBucket,
      end,
    };

    const readIntervals = async (
      labels: string,
    ): Promise<{ intervals: HistogramInterval[]; groups: number }> => {
      if (isExponential) {
        const rows = await this.client.execute<ExpHistogramRowRaw>(
          histogramGroupsSql(expHistogramSql(table, points, labels, bucketSql)),
          params,
        );
        const numbers = (map: Record<string, number | string>) =>
          Object.fromEntries(Object.entries(map).map(([k, v]) => [k, toNumber(v)]));
        const { shift, histograms: decoded } = fitExponentialScale(
          rows.map((row) => ({
            row,
            positive: numbers(row.positive),
            negative: numbers(row.negative),
          })),
        );
        // One span for every row keeps every interval on the same bounds.
        const span = exponentialSpan(decoded);
        return {
          groups: rows[0] ? toNumber(rows[0].groups) : 0,
          intervals: decoded.map(({ row, positive, negative }): HistogramInterval => ({
            ts: toNumber(row.ts),
            labels: row.labels,
            ...exponentialBuckets(
              toNumber(row.scale) - shift,
              positive,
              negative,
              toNumber(row.zero),
              span,
            ),
            count: toNumber(row.observations),
            sum: toNumber(row.observedSum),
            rate: toNumber(row.observedRate),
          })),
        };
      }
      const rows = await this.client.execute<HistogramRowRaw>(
        histogramGroupsSql(histogramSql(table, points, labels, bucketSql)),
        params,
      );
      return {
        groups: rows[0] ? toNumber(rows[0].groups) : 0,
        intervals: rows.map((row): HistogramInterval => ({
          ts: toNumber(row.ts),
          labels: row.labels,
          bounds: row.bounds.map(toNumber),
          counts: row.bucketCounts.map(toNumber),
          count: toNumber(row.observations),
          sum: toNumber(row.observedSum),
          rate: toNumber(row.observedRate),
        })),
      };
    };
    if (isHistogram) {
      // The heatmap adds every group together, so a grouped chart reads it
      // ungrouped: the row cap above would leave the smallest groups out.
      const [grouped, all] = await Promise.all([
        readIntervals(labelsSql),
        input.heatmap && input.groupBy.length > 0
          ? readIntervals(groupLabels([]).labelsSql)
          : undefined,
      ]);
      const { series, merged } = histogramSeries(
        grouped.intervals.filter((interval) => interval.ts <= lastRateBucket),
        grid,
        input.aggregation,
      );
      const ranked = rankSeries(series, grid, step);
      // Groups left out by the cap count as lines; the ones read count only
      // if they drew one.
      const read = new Set(grouped.intervals.map((interval) => JSON.stringify(interval.labels)));
      return {
        ...ranked,
        totalSeries: ranked.totalSeries + grouped.groups - read.size,
        ...(input.heatmap ? { heatmap: histogramHeatmap((all ?? grouped).intervals, grid) } : {}),
        merged,
      };
    }

    if (input.type === "summary") {
      const quantile = SUMMARY_QUANTILES[input.aggregation];
      if (quantile === undefined) {
        const rows = await this.client.execute<SeriesRowRaw>(
          topSeriesSql(
            this.counterSql(table, points, labelsSql, bucketSql, input.aggregation, SUMMARY_SOURCE),
          ),
          params,
        );
        return assembleSeries(rows, grid, step);
      }
      // The lowest minimum and the highest maximum are exact across series.
      const exact = input.aggregation === "min" || input.aggregation === "max";
      const rows = await this.client.execute<SeriesRowRaw & { seriesCount: number | string }>(
        topSeriesSql(
          this.summaryQuantileSql(
            table,
            points,
            labelsSql,
            bucketSql,
            input.aggregation === "min" ? "min" : "max",
          ),
        ),
        { ...params, quantile: String(quantile) },
      );
      const most = Math.max(0, ...rows.map((row) => toNumber(row.seriesCount)));
      return {
        ...assembleSeries(rows, grid, step),
        ...(most > 1 && !exact ? { highestOf: most } : {}),
      };
    }

    const sql = isCounter
      ? this.counterSql(table, points, labelsSql, bucketSql, input.aggregation)
      : `
SELECT ts, labels, ${levelOuterSql(input.aggregation)} AS value
FROM (${carriedSql(`
  SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
    ${SERIES_SQL} AS series,
    toUInt32(max(TimeUnix)) AS t,
    ${levelInnerSql(input.aggregation)} AS v
  FROM ${table}
  WHERE ${points}
  GROUP BY bucket, labels, series`)}
)
GROUP BY ts, labels`;

    const rows = await this.client.execute<SeriesRowRaw>(topSeriesSql(sql), params);
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
    // total, so the change is the difference from the series' previous bucket,
    // plus what each restart in the bucket dropped (see cumulativeBucketsSql): a drop, or
    // a new start time, means the process restarted and counted up from zero
    // again. A series' first point counts only when the series started in the
    // scan. A change spanning more than a step is
    // spread over the buckets it covers (see SPREAD_SQL). `total` follows the
    // same restarts as the counted value, so avg is total over count.
    const outer =
      aggregation === "avg"
        ? "sum(totalChange * share) / nullIf(sum(change * share), 0)"
        : aggregation === "rate"
          ? `sum(change * share / ${CHANGE_SECONDS_SQL})`
          : "sum(change * share)";
    return `
SELECT b AS ts, labels, ${outer} AS value
FROM (
  SELECT b, labels, t, f, change, totalChange, ${SPREAD_SHARE_SQL} AS share
  FROM (
    SELECT labels, t,
      if(temporality = 1, ${DELTA_FROM_SQL}, ${CUMULATIVE_FROM_SQL}) AS f,
      if(temporality = 1, toFloat64(delta),
        toFloat64(last) - if(firstReset, 0, toFloat64(previous)) + lost) AS change,
      if(temporality = 1, toFloat64(deltaTotal),
        toFloat64(lastTotal) - if(firstReset, 0, toFloat64(previousTotal)) + lostTotal) AS totalChange
    FROM (
      SELECT *,
        position > 1 AND (firstCounted < previous OR ${FIRST_START_CHANGED_SQL}) AS firstReset
      FROM (
        SELECT *,
          ${previousOr("last", "firstCounted", "0")} OVER w AS previous,
          ${previousOr("lastTotal", "firstTotal", "0")} OVER w AS previousTotal,
          ${PREVIOUS_T_SQL},
          lagInFrame(lastStart) OVER w AS previousStart,
          row_number() OVER w AS position
        FROM (${cumulativeBucketsSql({
          from: `${table} WHERE ${where}`,
          bucketSql,
          labelsSql,
          aggregates: `any(${source.temporality}) AS temporality,
            sum(${source.value}) AS delta,
            argMax(${source.value}, TimeUnix) AS last,
            sum(${source.total}) AS deltaTotal,
            argMax(${source.total}, TimeUnix) AS lastTotal,
            argMin(${source.total}, TimeUnix) AS firstTotal`,
          temporality: source.temporality,
          counted: source.value,
          compared: { Value: source.value, Total: source.total },
          drop: "curValue < prevValue",
          lost: `sumIf(toFloat64(prevValue), reset) AS lost,
            sumIf(toFloat64(prevTotal), reset) AS lostTotal`,
        })})
        WINDOW w AS (PARTITION BY series ORDER BY bucket ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )
      WHERE ${COUNTED_BUCKETS_SQL}
    )
  )
  ARRAY JOIN ${SPREAD_BUCKETS_SQL} AS b
)
WHERE b >= {gridStart:UInt32} AND b <= {lastRateBucket:UInt32}
GROUP BY b, labels`;
  }

  /**
   * A summary's quantiles were computed by the SDK over its own window, so
   * they can't be combined across series. Each series' last value per
   * interval is kept, and a group with several series shows the highest:
   * for latency, the slowest instance. A minimum combines exactly, as the
   * lowest.
   */
  private summaryQuantileSql(
    table: string,
    where: string,
    labelsSql: string,
    bucketSql: string,
    combine: "min" | "max",
  ) {
    return `
SELECT ts, labels, ${combine}(v) AS value, uniqExact(series) AS seriesCount
FROM (${carriedSql(`
  SELECT ${bucketSql} AS bucket, ${labelsSql} AS labels,
    ${SERIES_SQL} AS series,
    toUInt32(max(TimeUnix)) AS t,
    argMax(ValueAtQuantiles.Value[indexOf(ValueAtQuantiles.Quantile, wanted)], TimeUnix) AS v
  FROM ${table}
  -- A String parameter: the local app's SQL gateway takes no Float64.
  WHERE ${where} AND has(ValueAtQuantiles.Quantile, toFloat64({quantile:String}) AS wanted)
  GROUP BY bucket, labels, series`)}
)
GROUP BY ts, labels`;
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
    const { step } = seriesStep(fromDate, toDate, input.minStep);
    const where = baseWhere(input);
    const { labelsSql, groupParams } = groupLabels(input.groupBy);
    // Some SDKs attach an exemplar to every export until a new one replaces
    // it, so an exemplar counts only if it was sampled after the series' last
    // export before the interval: one carried over from an earlier interval
    // was sampled before that export. Within an interval only the highest is
    // kept, so a repeat there changes nothing. The scan starts early so the
    // first interval has an export before it.
    const start = Math.floor(seconds(fromDate) / step) * step;
    const scanFrom = new Date((start - Math.max(step, LOOKBACK_SECONDS)) * 1000);
    const table = this.tables[input.type];
    const params = {
      ...where.params,
      ...groupParams,
      ...windowParams(scanFrom, toDate),
      start,
      step,
    };
    // Most metrics carry no exemplars. Finding that out reads only the
    // exemplar counts, where the query below reads every series' attributes.
    const carrying = await this.client.execute(
      `SELECT 1 FROM ${table}
WHERE ${where.clause} AND TimeUnix >= toDateTime({start:UInt32}) AND notEmpty(Exemplars.TraceId)
LIMIT 1`,
      params,
    );
    if (carrying.length === 0) return [];
    const interval = "toUInt32(toStartOfInterval(TimeUnix, INTERVAL {step:UInt32} SECOND))";
    const sql = `
SELECT ts, time, value, traceId, spanId, labels
FROM (
  SELECT ts, labels, series,
    argMax((toString(exemplarTime), exemplarValue, exemplarTrace, exemplarSpan), exemplarValue) AS best,
    best.1 AS time, best.2 AS value, best.3 AS traceId, best.4 AS spanId
  FROM (
    -- The interval of the export that carries it, which is where the chart
    -- counts the observation it sampled; its own time can be an interval earlier.
    SELECT ${interval} AS ts, ${labelsSql} AS labels, ${SERIES_SQL} AS series,
      Exemplars.TimeUnix AS times, Exemplars.Value AS values,
      Exemplars.TraceId AS traces, Exemplars.SpanId AS spans
    FROM ${table}
    WHERE ${where.clause}
      AND TimeUnix >= toDateTime({start:UInt32})
      AND notEmpty(Exemplars.TraceId)
  ) AS points
  -- One row per interval and series, however many exports the range holds.
  INNER JOIN (
    SELECT ts, series, previous
    FROM (
      SELECT ts, series, withExemplars,
        lagInFrame(last, 1, toDateTime(0)) OVER (
          PARTITION BY series ORDER BY ts ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
        ) AS previous
      FROM (
        SELECT ${interval} AS ts, ${SERIES_SQL} AS series, max(TimeUnix) AS last,
          max(notEmpty(Exemplars.TraceId)) AS withExemplars
        FROM ${table}
        WHERE ${where.clause}
        GROUP BY ts, series
      )
    )
    WHERE withExemplars AND ts >= {start:UInt32}
  ) AS intervals USING (ts, series)
  ARRAY JOIN times AS exemplarTime, values AS exemplarValue,
    traces AS exemplarTrace, spans AS exemplarSpan
  WHERE exemplarTrace != '' AND exemplarTime > previous
  GROUP BY ts, labels, series
)
ORDER BY value DESC
LIMIT ${EXEMPLAR_LIMIT}
-- The join builds its table from the intervals. ClickHouse would otherwise
-- build it from the exports when it guesses those are fewer, holding every
-- exemplar in the range in memory.
SETTINGS query_plan_join_swap_table = 'false'`;
    const rows = await this.client.execute<{
      ts: number | string;
      time: string;
      value: number | string;
      traceId: string;
      spanId: string;
      labels: string[];
    }>(sql, params);
    return rows.map((row) => ({
      ts: toNumber(row.ts),
      time: row.time,
      value: toNumber(row.value),
      traceId: row.traceId,
      spanId: row.spanId,
      labels: row.labels,
    }));
  }

  /**
   * Every key the metric's points carry in range, capped per source as the
   * other signals' key lists are, so metric keys can't crowd out resource
   * keys. It reads the maps' key subcolumns: ClickHouse doesn't rewrite
   * mapKeys() to them, and reading the whole map decompresses every value.
   */
  async attributeKeys(input: MetricAttributeKeysInput): Promise<AttributeKey[]> {
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const selects = (["metric", "resource"] as const).map(
      (source) => `
  SELECT key, source FROM (
    SELECT DISTINCT arrayJoin(${attributeColumn(source)}.keys) AS key, '${source}' AS source
    FROM ${this.tables[input.type]}
    WHERE ${TIME_WINDOW_SQL} AND MetricName = {metric:String}
  )
  WHERE key != '' AND key NOT IN {hidden:Array(String)}
  ORDER BY key
  LIMIT ${ATTRIBUTE_KEY_PER_SOURCE_LIMIT}`,
    );
    const rows = await this.client.execute<{ source: AttributeSource; key: string }>(
      `
SELECT key, source FROM (${selects.join("\n  UNION ALL")}
)
ORDER BY source, key`,
      { ...windowParams(fromDate, toDate), metric: input.metric, hidden: HIDDEN_KEYS },
    );
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
      ...windowParams(fromDate, toDate),
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
      ...windowParams(fromDate, toDate),
    });
    return rows.map((row) => row.value);
  }

  /** The quantiles a summary reports, so the explorer offers only those. */
  async summaryQuantiles(raw: MetricSummaryQuantilesInput): Promise<number[]> {
    const input = MetricSummaryQuantilesInputSchema.parse(raw);
    const { fromDate, toDate } = resolveTimeRange(input.timeRange);
    const where = baseWhere(input);
    const rows = await this.client.execute<{ quantile: number | string }>(
      `
SELECT DISTINCT arrayJoin(ValueAtQuantiles.Quantile) AS quantile
FROM ${this.tables.summary}
WHERE ${where.clause}
ORDER BY quantile
LIMIT 50`,
      { ...where.params, ...windowParams(fromDate, toDate) },
    );
    return rows.map((row) => toNumber(row.quantile));
  }
}

/** Lines the rows up on the bucket grid. */
function assembleSeries(rows: SeriesRowRaw[], grid: number[], step: number): MetricSeriesResult {
  const groups = rows[0] ? toNumber(rows[0].groups) : 0;
  const indexOf = new Map(grid.map((t, i) => [t, i]));
  const byLabels = new Map<string, MetricSeries>();
  for (const row of rows) {
    const index = indexOf.get(toNumber(row.ts));
    if (index === undefined) continue;
    const value = toNumber(row.value);
    const id = JSON.stringify(row.labels);
    let entry = byLabels.get(id);
    if (!entry) {
      entry = { labels: row.labels, values: grid.map(() => null) };
      byLabels.set(id, entry);
    }
    entry.values[index] = value;
  }
  return { ...rankSeries([...byLabels.values()], grid, step), totalSeries: groups };
}

/**
 * Orders series by their peak and keeps the top ones, so one high-cardinality
 * key can't flood the chart. Series read from SQL arrive already cut; a
 * histogram's percentiles are only known here.
 */
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
