import { ALL_VALUE } from "../../interpolate";
import type { Variable } from "../../schema";
import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  metricLine,
  metricUnion,
  needsMetricNamespace,
  needsMetrics,
  SERIES_BUCKET,
} from "./shared";

/** Picker over whatever metric names the Organization actually sends. */
const metricVariable: Variable = {
  kind: "ListVariable",
  spec: {
    name: "metric",
    display: { name: "Metric" },
    allowMultiple: true,
    allowAllValue: true,
    defaultValue: ALL_VALUE,
    sort: "alphabetical-asc",
    plugin: {
      kind: "ClickHouseSQLVariable",
      spec: {
        query: `SELECT DISTINCT MetricName FROM (${metricUnion("MetricName")})
ORDER BY MetricName`,
      },
    },
  },
};

/** Instance identity, so per-scrape sums do not mix two processes together. */
const INSTANCE = "ResourceAttributes['service.instance.id'] AS instance";

const WITHIN_METRICS_LOCAL =
  "TimeUnix >= {from:String} AND TimeUnix <= {to:String}";

/**
 * Used against the V8 limit, per scrape and per process. `used` is reported per
 * heap space so it is summed; `limit` is one value, so it is taken as-is.
 */
const HEAP_HEADROOM = `SELECT avg(pct) AS pct
FROM (
  SELECT TimeUnix, ${INSTANCE},
         sumIf(Value, MetricName = 'v8js.memory.heap.used') AS used,
         maxIf(Value, MetricName = 'v8js.memory.heap.limit') AS lim,
         used / nullIf(lim, 0) * 100 AS pct
  FROM (${metricUnion("TimeUnix, ResourceAttributes, MetricName, Value", " AND MetricName IN ('v8js.memory.heap.used', 'v8js.memory.heap.limit')")})
  GROUP BY TimeUnix, instance
  HAVING lim > 0
)`;

/** One heap-space breakdown, split by space and capped like every series chart. */
const heapSpacePanel = (name: string, metric: string) =>
  metricLine(name, `v8js.memory.heap.space.${metric}`, {
    unit: "MB",
    scale: "/ 1048576",
    seriesBy: "v8js.heap.space.name",
  });

export const runtimeTemplates: DashboardTemplate[] = [
  {
    id: "metric-overview",
    name: "Metric Overview",
    description:
      "Every metric you send, in one place: what exists, how often it reports, and the shape of the ones you pick.",
    category: "Runtime",
    requires: [needsMetrics],
    document: {
      kind: "Dashboard",
      metadata: { name: "metric-overview" },
      spec: {
        display: { name: "Metric Overview" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [metricVariable],
        panels: {
          "metric-count": stat(
            "Distinct metrics",
            { calculation: "last" },
            `SELECT uniqExact(MetricName) AS metrics FROM (${metricUnion("MetricName")})`,
          ),
          "series-count": stat(
            "Data points",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET("TimeUnix")} AS ts, count() AS points FROM (${metricUnion("TimeUnix")})
GROUP BY ts
ORDER BY ts`,
          ),
          "service-count": stat(
            "Reporting services",
            { calculation: "last" },
            `SELECT uniqExact(ServiceName) AS services FROM (${metricUnion("ServiceName")})`,
          ),
          selected: timeSeries(
            "Selected metrics",
            { showLegend: true },
            `SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
       MetricName,
       avg(Value) AS value
FROM (${metricUnion("TimeUnix, MetricName, Value", " AND MetricName IN $metric")})
GROUP BY ts, MetricName
ORDER BY ts`,
            "Averaged across every series. Narrow the Metric picker before reading absolute values.",
          ),
          catalog: table(
            "Metric catalog",
            `SELECT MetricName AS metric,
       any(MetricUnit) AS unit,
       any(MetricDescription) AS description,
       uniqExact(ServiceName) AS services,
       count() AS points
FROM (${metricUnion("MetricName, MetricUnit, MetricDescription, ServiceName")})
GROUP BY metric
ORDER BY points DESC
LIMIT 100`,
          ),
        },
        layouts: layout([
          split(5, "metric-count", "series-count", "service-count"),
          split(9, "selected"),
          split(10, "catalog"),
        ]),
      },
    },
  },

  {
    id: "jvm-runtime",
    name: "JVM Runtime",
    description:
      "Heap, garbage collection, threads and CPU for JVM services instrumented with the OpenTelemetry Java agent.",
    category: "Runtime",
    requires: [needsMetrics, needsMetricNamespace("jvm")],
    document: {
      kind: "Dashboard",
      metadata: { name: "jvm-runtime" },
      spec: {
        display: { name: "JVM Runtime" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          "heap-used": metricLine("Heap used", "jvm.memory.used", {
            unit: "MB",
            scale: "/ 1048576",
            seriesBy: "jvm.memory.pool.name",
          }),
          "gc-duration": metricLine("GC duration", "jvm.gc.duration", {
            unit: "s",
            aggregate: "max",
            seriesBy: "jvm.gc.name",
          }),
          threads: metricLine("Live threads", "jvm.thread.count"),
          cpu: metricLine("CPU utilization", "jvm.cpu.recent_utilization", {
            unit: "%",
            scale: "* 100",
          }),
          "classes-loaded": metricLine("Classes loaded", "jvm.class.count"),
        },
        layouts: layout([
          split(8, "heap-used", "gc-duration"),
          split(8, "cpu", "threads"),
          split(7, "classes-loaded"),
        ]),
      },
    },
  },

  {
    id: "nodejs-runtime",
    name: "Node.js Runtime",
    description:
      "Event-loop delay and utilization, V8 heap against its limit, and the heap spaces behind it, for services running the OpenTelemetry Node runtime instrumentation.",
    category: "Runtime",
    requires: [needsMetrics, needsMetricNamespace("nodejs")],
    document: {
      kind: "Dashboard",
      metadata: { name: "nodejs-runtime" },
      spec: {
        display: { name: "Node.js Runtime" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          utilization: stat(
            "Event-loop utilization",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(80, 95),
            },
            `SELECT avg(Value) * 100 AS pct
FROM (${metricUnion("Value", " AND MetricName = 'nodejs.eventloop.utilization'")})`,
            "Share of the loop's time spent working. Sustained near 100% means it never catches up.",
          ),
          "delay-p99": stat(
            "Delay P99",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT avg(Value) * 1000 AS ms
FROM (${metricUnion("Value", " AND MetricName = 'nodejs.eventloop.delay.p99'")})`,
          ),
          "heap-used": stat(
            "Heap used",
            { calculation: "last", unit: "MB", decimals: 0 },
            // Summed across spaces per scrape before averaging: the metric is
            // reported per heap space, so averaging it directly would report the
            // size of an average space rather than the heap.
            `SELECT avg(total) / 1048576 AS mb
FROM (
  SELECT TimeUnix, ${INSTANCE}, sum(Value) AS total
  FROM (${metricUnion(`TimeUnix, ResourceAttributes, Value`, " AND MetricName = 'v8js.memory.heap.used'")})
  GROUP BY TimeUnix, instance
)`,
          ),
          headroom: stat(
            "Heap headroom",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(75, 90),
            },
            HEAP_HEADROOM,
            "Used against the V8 limit. This is what runs out before a heap OOM.",
          ),
          "delay-percentiles": timeSeries(
            "Event-loop delay percentiles",
            { unit: "ms", showLegend: true },
            // Three separate metric names rather than one metric with a
            // quantile attribute, so they are unioned into a labelled series.
            `SELECT ${SERIES_BUCKET("TimeUnix")} AS ts, series, avg(Value) * 1000 AS ms
FROM (
  ${["p50", "p90", "p99"]
    .map(
      (p) =>
        `SELECT TimeUnix, '${p}' AS series, Value FROM (${metricUnion("TimeUnix, Value", ` AND MetricName = 'nodejs.eventloop.delay.${p}'`)})`,
    )
    .join("\n  UNION ALL\n  ")}
)
GROUP BY ts, series
ORDER BY ts`,
          ),
          "utilization-over-time": metricLine(
            "Event-loop utilization over time",
            "nodejs.eventloop.utilization",
            { unit: "%", scale: "* 100" },
          ),
          "heap-vs-limit": timeSeries(
            "Heap used against limit",
            { unit: "MB", showLegend: true },
            `SELECT ts, series, avg(bytes) / 1048576 AS mb
FROM (
  SELECT ${SERIES_BUCKET("TimeUnix")} AS ts, TimeUnix, ${INSTANCE},
         sumIf(Value, MetricName = 'v8js.memory.heap.used') AS used,
         maxIf(Value, MetricName = 'v8js.memory.heap.limit') AS lim
  FROM (${metricUnion("TimeUnix, ResourceAttributes, MetricName, Value", " AND MetricName IN ('v8js.memory.heap.used', 'v8js.memory.heap.limit')")})
  GROUP BY ts, TimeUnix, instance
)
ARRAY JOIN [used, lim] AS bytes, ['used', 'limit'] AS series
WHERE lim > 0
GROUP BY ts, series
ORDER BY ts`,
          ),
          "gc-duration": timeSeries(
            "GC duration",
            { unit: "ms", showLegend: false },
            // A histogram, so the mean is sum/count rather than a value column.
            `SELECT ${BUCKET("TimeUnix")} AS ts,
       sum(Sum) / nullIf(sum(Count), 0) * 1000 AS ms
FROM metrics_histogram
WHERE ${WITHIN_METRICS_LOCAL} AND MetricName = 'v8js.gc.duration'
GROUP BY ts
ORDER BY ts`,
            "Mean pause per collection. Absent unless the runtime instrumentation reports GC.",
          ),
          "space-size": heapSpacePanel("Heap space size", "size"),
          "space-used": heapSpacePanel("Heap space used", "physical_size"),
          "space-available": heapSpacePanel(
            "Heap space available",
            "available_size",
          ),
          "eventloop-time": timeSeries(
            "Event-loop time by state",
            { unit: "s", showLegend: true, stacked: true },
            // A cumulative counter: the per-bucket increase is the time spent in
            // that state during the bucket, which is the readable quantity.
            `SELECT ts, series, sum(seconds) AS value
FROM (
  SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
         Attributes['nodejs.eventloop.state'] AS series,
         ${INSTANCE},
         max(Value) - min(Value) AS seconds
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Attributes, Value", " AND MetricName = 'nodejs.eventloop.time'")})
  GROUP BY ts, series, instance
)
GROUP BY ts, series
ORDER BY ts`,
          ),
        },
        layouts: layout([
          split(5, "utilization", "delay-p99", "heap-used", "headroom"),
          split(8, "delay-percentiles", "utilization-over-time"),
          split(8, "heap-vs-limit", "gc-duration"),
          split(8, "space-size", "space-used"),
          split(8, "space-available", "eventloop-time"),
        ]),
      },
    },
  },
];
