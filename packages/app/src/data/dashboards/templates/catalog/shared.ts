import { ALL_VALUE } from "../../interpolate";
import type { Panel, Variable } from "../../schema";
import { layout, split, stat, thresholds, timeSeries } from "../build";
import type {
  DashboardTemplate,
  TemplateCategory,
  TemplateRequirement,
} from "../types";

/**
 * The service picker every trace-backed template opens with. It defaults to
 * All so a template previews as the whole system before the reader has chosen
 * anything, and stays multi-select so narrowing is one click, not a re-pick.
 */
export const serviceVariable = (
  table: "traces" | "logs" = "traces",
): Variable => ({
  kind: "ListVariable",
  spec: {
    name: "service",
    display: { name: "Service" },
    allowMultiple: true,
    allowAllValue: true,
    defaultValue: ALL_VALUE,
    sort: "alphabetical-asc",
    plugin: {
      kind: "ClickHouseSQLVariable",
      spec: {
        query: `SELECT DISTINCT ServiceName FROM ${table} WHERE Timestamp >= {from:String} AND Timestamp <= {to:String} ORDER BY ServiceName`,
      },
    },
  },
});

export const needsTraces: TemplateRequirement = {
  kind: "signal",
  match: "traces",
  label: "no traces",
};

export const needsLogs: TemplateRequirement = {
  kind: "signal",
  match: "logs",
  label: "no logs",
};

export const needsMetrics: TemplateRequirement = {
  kind: "signal",
  match: "metrics",
  label: "no metrics",
};

export const needsSpanAttribute = (match: string): TemplateRequirement => ({
  kind: "span-attribute",
  match,
  label: `no ${match}*`,
});

export const needsMetricNamespace = (match: string): TemplateRequirement => ({
  kind: "metric",
  match,
  label: `no ${match}*`,
});

export const needsLogAttribute = (match: string): TemplateRequirement => ({
  kind: "log-attribute",
  match,
  label: `no ${match}*`,
});

/** Window bound shared by every trace/log panel below. */
export const WITHIN = "Timestamp >= {from:String} AND Timestamp <= {to:String}";
const WITHIN_METRICS = "TimeUnix >= {from:String} AND TimeUnix <= {to:String}";
export const OF_SERVICE = "ServiceName IN $service";

/** Bucketed timestamp expression, sized by the panel's adaptive `{step}`. */
export const BUCKET = (column = "Timestamp") =>
  `toStartOfInterval(${column}, INTERVAL {step:UInt32} SECOND)`;

/**
 * The SQL API profile caps a result at 1000 rows with
 * `result_overflow_mode = 'throw'`, so an oversized panel errors rather than
 * truncating. `{step}` is sized for ~500 buckets, which is safe for a single
 * line and blows the cap the moment a chart splits into series.
 *
 * Multi-series charts therefore buy their series with time resolution: a
 * coarser bucket and a hard ceiling on how many series are drawn. The two
 * constants multiply out to well under the cap, so a template can never render
 * an error panel just because the reader picked a wide range or the
 * Organization runs more services than expected.
 */
const SERIES_BUCKET_FACTOR = 6;
const MAX_SERIES = 8;

export const SERIES_BUCKET = (column = "Timestamp") =>
  `toStartOfInterval(${column}, INTERVAL {step:UInt32} * ${SERIES_BUCKET_FACTOR} SECOND)`;

/**
 * Restrict a series dimension to the busiest `MAX_SERIES` values over the whole
 * window. Chosen once for the range rather than per bucket, so a series stays
 * on the chart for its full life instead of flickering in and out of the top N.
 */
export const topSeries = (
  dimension: string,
  from: string,
  where = "1",
): string =>
  `${dimension} IN (
  SELECT ${dimension} FROM ${from} WHERE ${where}
  GROUP BY ${dimension} ORDER BY count() DESC LIMIT ${MAX_SERIES}
)`;

/**
 * The tables a metric can land in, read as one. Gauges go to `metrics_gauge`
 * and monotonic counters to `metrics_sum`, and which one a receiver picks is
 * its business, not the template's.
 */
export const metricUnion = (columns: string, extraWhere = "") =>
  ["metrics_gauge", "metrics_sum"]
    .map(
      (table) =>
        `SELECT ${columns} FROM ${table} WHERE ${WITHIN_METRICS}${extraWhere}`,
    )
    .join(" UNION ALL ");

const metricRows = (metric: string, seriesBy?: string) =>
  metricUnion(
    `TimeUnix, Value${seriesBy ? `, Attributes['${seriesBy}'] AS series` : ""}`,
    ` AND MetricName = '${metric}'`,
  );

/**
 * A metric line chart. Metric-backed templates repeat this shape for every
 * panel, so it is written once: the receiver's own metric name is the only
 * thing that changes. Passing `seriesBy` splits the line by one metric
 * attribute (a database name, a device, a pod).
 */
export const metricLine = (
  name: string,
  metric: string,
  options: {
    aggregate?: string;
    unit?: string;
    seriesBy?: string;
    scale?: string;
    description?: string;
  } = {},
) => {
  const {
    aggregate = "avg",
    unit = "",
    seriesBy,
    scale,
    description,
  } = options;
  const value = scale ? `${aggregate}(Value) ${scale}` : `${aggregate}(Value)`;

  if (!seriesBy) {
    return timeSeries(
      name,
      { unit, showLegend: false },
      `SELECT ${BUCKET("TimeUnix")} AS ts,
       ${value} AS value
FROM (${metricRows(metric)})
GROUP BY ts
ORDER BY ts`,
      description,
    );
  }

  // The two-table union is named once and referenced twice: inlining it in both
  // the scan and the top-series filter emitted the same UNION ALL three times
  // in every metric panel's SQL.
  return timeSeries(
    name,
    { unit, showLegend: true },
    `WITH points AS (${metricRows(metric, seriesBy)})
SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
       series,
       ${value} AS value
FROM points
WHERE ${topSeries("series", "points")}
GROUP BY ts, series
ORDER BY ts`,
    description,
  );
};

/**
 * Receiver-backed templates are all the same board: a handful of that
 * receiver's own metrics, two to a row. Only the metric names differ, so the
 * shape is written once and every receiver fills in its own list.
 */
export function receiverTemplate(input: {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  namespace: string;
  duration?: string;
  panels: Record<string, Panel>;
}): DashboardTemplate {
  const keys = Object.keys(input.panels);
  const rows = [];
  for (let i = 0; i < keys.length; i += 2) {
    rows.push(split(8, ...keys.slice(i, i + 2)));
  }
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    category: input.category,
    requires: [needsMetrics, needsMetricNamespace(input.namespace)],
    document: {
      kind: "Dashboard",
      metadata: { name: input.id },
      spec: {
        display: { name: input.name },
        duration: input.duration ?? "6h",
        refreshInterval: "1m",
        panels: input.panels,
        layouts: layout(rows),
      },
    },
  };
}

/** The error-rate tile five templates share, optionally scoped further. */
export const errorRateStat = (extraWhere = "") =>
  stat(
    "Error rate",
    {
      calculation: "last",
      unit: "%",
      decimals: 2,
      thresholds: thresholds(1, 5),
    },
    `SELECT countIf(StatusCode = 'Error') / count() * 100 AS error_pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}${extraWhere}`,
  );

/** The P95 tile four templates share, in milliseconds. */
export const p95LatencyStat = (name = "P95 latency", extraWhere = "") =>
  stat(
    name,
    { calculation: "last", unit: "ms", decimals: 1 },
    `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}${extraWhere}`,
  );
