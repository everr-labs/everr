import { ALL_VALUE } from "../../interpolate";
import type { Variable } from "../../schema";
import { timeSeries } from "../build";
import type { TemplateRequirement } from "../types";

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
export const WITHIN_METRICS =
  "TimeUnix >= {from:String} AND TimeUnix <= {to:String}";
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
  where: string,
): string =>
  `${dimension} IN (
  SELECT ${dimension} FROM ${from} WHERE ${where}
  GROUP BY ${dimension} ORDER BY count() DESC LIMIT ${MAX_SERIES}
)`;

/**
 * Rows for one metric, from whichever table the receiver wrote it to.
 *
 * Gauges land in `metrics_gauge` and monotonic counters in `metrics_sum`, and
 * which one a given receiver picks is its business, not the template's. Reading
 * the union means a template never silently renders empty because the metric
 * turned out to be a sum.
 */
const metricRows = (metric: string, seriesBy?: string) => {
  const series = seriesBy ? `, Attributes['${seriesBy}'] AS series` : "";
  return ["metrics_gauge", "metrics_sum"]
    .map(
      (table) =>
        `SELECT TimeUnix, Value${series} FROM ${table} WHERE ${WITHIN_METRICS} AND MetricName = '${metric}'`,
    )
    .join(" UNION ALL ");
};

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
  return timeSeries(
    name,
    { unit, showLegend: true },
    `SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
       series,
       ${value} AS value
FROM (${metricRows(metric, seriesBy)})
WHERE ${topSeries("series", `(${metricRows(metric, seriesBy)})`, "1")}
GROUP BY ts, series
ORDER BY ts`,
    description,
  );
};
