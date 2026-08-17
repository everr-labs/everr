import { ALL_VALUE } from "../../interpolate";
import type { Variable } from "../../schema";
import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { BuiltinDashboard } from "../types";
import {
  BUCKET,
  metricCounterUnion,
  metricLine,
  metricLineUnion,
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

/**
 * Every `jvm.memory.*` datapoint is reported per memory pool, so one area is
 * the sum of its pools at a single scrape. Averaging the raw metric would
 * report the size of an average pool rather than the heap, which is the trap
 * the Node.js rebuild hit on `v8js.memory.heap.used`.
 *
 * `used`, `committed` and `limit` are three metric names for one picture, so
 * the name becomes the series label. The pair-of-names union helpers cannot be
 * used here, because the area itself is an attribute filter.
 */
const JVM_MEMORY = [
  "jvm.memory.used",
  "jvm.memory.committed",
  "jvm.memory.limit",
];

const jvmMemoryArea = (name: string, type: string, description: string) =>
  timeSeries(
    name,
    { unit: "MB", showLegend: true },
    `SELECT ts, series, avg(bytes) / 1048576 AS mb
FROM (
  SELECT ${SERIES_BUCKET("TimeUnix")} AS ts, TimeUnix, ${INSTANCE},
         sumIf(Value, MetricName = 'jvm.memory.used') AS used,
         sumIf(Value, MetricName = 'jvm.memory.committed') AS committed,
         sumIf(Value, MetricName = 'jvm.memory.limit') AS lim
  FROM (${metricUnion("TimeUnix, ResourceAttributes, MetricName, Value", ` AND MetricName IN (${JVM_MEMORY.map((m) => `'${m}'`).join(", ")}) AND Attributes['jvm.memory.type'] = '${type}'`)})
  GROUP BY ts, TimeUnix, instance
)
ARRAY JOIN [used, committed, lim] AS bytes, ['used', 'committed', 'limit'] AS series
WHERE bytes > 0
GROUP BY ts, series
ORDER BY ts`,
    description,
  );

/**
 * `jvm.memory.used` summed over the pools of one area, per scrape and per
 * process, as a single number for the window.
 */
const jvmAreaTotal = (type: string) => `SELECT avg(total) AS bytes
FROM (
  SELECT TimeUnix, ${INSTANCE}, sum(Value) AS total
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Value", ` AND MetricName = 'jvm.memory.used' AND Attributes['jvm.memory.type'] = '${type}'`)})
  GROUP BY TimeUnix, instance
)`;

/**
 * `jvm.gc.duration` is a histogram, not a value column, and the Java agent
 * exports it cumulatively. Collections and total pause time are therefore the
 * per-bucket increase of `Count` and `Sum`, taken per unique series before
 * they are summed, exactly as `metricCounter` does for a cumulative sum.
 *
 * The garbage collector names are a fixed, tiny set, so there is no top-N cap
 * to apply; the coarser `SERIES_BUCKET` still applies, because the chart is
 * multi-series and the 1000-row cap counts rows.
 */
const GC_DELTAS = (bucket: string) => `SELECT ${bucket} AS ts,
         Attributes['jvm.gc.name'] AS series,
         ResourceAttributes AS resource, Attributes AS attrs,
         max(Count) - min(Count) AS collections,
         max(Sum) - min(Sum) AS seconds
  FROM metrics_histogram
  WHERE ${WITHIN_METRICS_LOCAL} AND MetricName = 'jvm.gc.duration'
  GROUP BY ts, series, resource, attrs`;

export const runtimeBuiltins: BuiltinDashboard[] = [
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
      "Heap and non-heap memory against their limits, the pools behind them, garbage collection, threads, classes and CPU, for services instrumented with the OpenTelemetry Java agent.",
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
          "heap-used": stat(
            "Heap used",
            { calculation: "last", unit: "MB", decimals: 0 },
            `SELECT bytes / 1048576 AS mb FROM (${jvmAreaTotal("heap")})`,
          ),
          "heap-of-limit": stat(
            "Heap of limit",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(75, 90),
            },
            `SELECT avg(pct) AS pct
FROM (
  SELECT TimeUnix, ${INSTANCE},
         sumIf(Value, MetricName = 'jvm.memory.used') AS used,
         sumIf(Value, MetricName = 'jvm.memory.limit') AS lim,
         used / nullIf(lim, 0) * 100 AS pct
  FROM (${metricUnion("TimeUnix, ResourceAttributes, MetricName, Value", " AND MetricName IN ('jvm.memory.used', 'jvm.memory.limit') AND Attributes['jvm.memory.type'] = 'heap'")})
  GROUP BY TimeUnix, instance
  HAVING lim > 0
)`,
          ),
          "non-heap-used": stat(
            "Non-heap used",
            { calculation: "last", unit: "MB", decimals: 0 },
            `SELECT bytes / 1048576 AS mb FROM (${jvmAreaTotal("non_heap")})`,
          ),
          threads: stat(
            "Live threads",
            { calculation: "last", decimals: 0 },
            // Reported per state and per daemon flag, so the total is the sum
            // of a scrape's datapoints, not the average of them.
            `SELECT avg(total) AS threads
FROM (
  SELECT TimeUnix, ${INSTANCE}, sum(Value) AS total
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Value", " AND MetricName = 'jvm.thread.count'")})
  GROUP BY TimeUnix, instance
)`,
          ),
          cpu: stat(
            "CPU used",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(75, 90),
            },
            `SELECT avg(Value) * 100 AS pct
FROM (${metricUnion("Value", " AND MetricName = 'jvm.cpu.recent_utilization'")})`,
          ),
          "heap-memory": jvmMemoryArea(
            "Heap memory",
            "heap",
            "Used against committed and the maximum obtainable heap. Pools that report no maximum are left out of the limit line.",
          ),
          "non-heap-memory": jvmMemoryArea(
            "Non-heap memory",
            "non_heap",
            "Metaspace, code cache and the rest. A limit line appears only for the pools that declare one.",
          ),
          "pool-used": metricLine("Memory used by pool", "jvm.memory.used", {
            unit: "MB",
            scale: "/ 1048576",
            seriesBy: "jvm.memory.pool.name",
          }),
          "pool-after-gc": metricLine(
            "Memory after last collection, by pool",
            "jvm.memory.used_after_last_gc",
            {
              unit: "MB",
              scale: "/ 1048576",
              seriesBy: "jvm.memory.pool.name",
              description:
                "The live set: what a collection could not reclaim. An old-generation line that climbs across collections is the shape of a leak.",
            },
          ),
          "gc-collections": timeSeries(
            "Collections",
            { unit: "", showLegend: true },
            `SELECT ts, series, sum(collections) AS value
FROM (
  ${GC_DELTAS(SERIES_BUCKET("TimeUnix"))}
)
GROUP BY ts, series
ORDER BY ts`,
            "Garbage collections per bucket, by collector.",
          ),
          "gc-pause": timeSeries(
            "Mean pause",
            { unit: "ms", showLegend: true },
            `SELECT ts, series, sum(seconds) / nullIf(sum(collections), 0) * 1000 AS ms
FROM (
  ${GC_DELTAS(SERIES_BUCKET("TimeUnix"))}
)
GROUP BY ts, series
ORDER BY ts`,
            "Total pause time over the collections that produced it.",
          ),
          "gc-pressure": timeSeries(
            "Time spent collecting",
            { unit: "%", showLegend: false },
            `SELECT ts, sum(seconds) / nullIf({step:UInt32}, 0) * 100 AS pct
FROM (
  ${GC_DELTAS(BUCKET("TimeUnix"))}
)
GROUP BY ts
ORDER BY ts`,
            "Pause time as a share of elapsed time, summed across every reporting process. One collector thread saturated reads as 100%.",
          ),
          "thread-states": metricLine("Threads by state", "jvm.thread.count", {
            seriesBy: "jvm.thread.state",
            description:
              "A rising blocked count with a flat runnable count is lock contention, not load.",
          }),
          "cpu-usage": metricLineUnion(
            "CPU usage",
            {
              process: "jvm.cpu.recent_utilization",
              system: "jvm.system.cpu.utilization",
            },
            {
              unit: "%",
              scale: "* 100",
              description:
                "The system line needs the agent's experimental JVM metrics enabled.",
            },
          ),
          load: metricLineUnion(
            "System load",
            {
              "load 1m": "jvm.system.cpu.load_1m",
              processors: "jvm.cpu.count",
            },
            {
              description:
                "Load above the processor count means work is queueing. The load line needs the agent's experimental JVM metrics enabled.",
            },
          ),
          classes: metricLine("Classes loaded", "jvm.class.count", {
            description: "Currently loaded, not loaded since start.",
          }),
          "class-activity": metricCounterUnion(
            "Class loading activity",
            { loaded: "jvm.class.loaded", unloaded: "jvm.class.unloaded" },
            {
              description:
                "Classes loaded and unloaded per bucket. Sustained loading long after startup points at a class-generating framework.",
            },
          ),
          buffers: metricLineUnion(
            "Buffer memory",
            {
              used: "jvm.buffer.memory.used",
              capacity: "jvm.buffer.memory.limit",
            },
            {
              unit: "MB",
              scale: "/ 1048576",
              description:
                "Direct and mapped byte buffers, which live outside the heap. Needs the agent's experimental JVM metrics enabled.",
            },
          ),
          "file-descriptors": metricLineUnion(
            "File descriptors",
            {
              open: "jvm.file_descriptor.count",
              limit: "jvm.file_descriptor.limit",
            },
            {
              description:
                "Needs the agent's experimental JVM metrics enabled.",
            },
          ),
        },
        layouts: layout([
          split(
            5,
            "heap-used",
            "heap-of-limit",
            "non-heap-used",
            "threads",
            "cpu",
          ),
          split(8, "heap-memory", "non-heap-memory"),
          split(8, "pool-used", "pool-after-gc"),
          split(8, "gc-collections", "gc-pause"),
          split(8, "gc-pressure", "thread-states"),
          split(8, "cpu-usage", "load"),
          split(8, "classes", "class-activity"),
          split(8, "buffers", "file-descriptors"),
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
