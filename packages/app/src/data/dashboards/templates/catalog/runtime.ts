import { ALL_VALUE } from "../../interpolate";
import type { Variable } from "../../schema";
import { layout, split, stat, table, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  metricLine,
  needsMetricNamespace,
  needsMetrics,
  SERIES_BUCKET,
  WITHIN_METRICS,
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
        query: `SELECT DISTINCT MetricName FROM (
  SELECT MetricName FROM metrics_gauge WHERE ${WITHIN_METRICS}
  UNION ALL
  SELECT MetricName FROM metrics_sum WHERE ${WITHIN_METRICS}
)
ORDER BY MetricName`,
      },
    },
  },
};

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
            `SELECT uniqExact(MetricName) AS metrics FROM (
  SELECT MetricName FROM metrics_gauge WHERE ${WITHIN_METRICS}
  UNION ALL
  SELECT MetricName FROM metrics_sum WHERE ${WITHIN_METRICS}
)`,
          ),
          "series-count": stat(
            "Data points",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET("TimeUnix")} AS ts, count() AS points FROM (
  SELECT TimeUnix FROM metrics_gauge WHERE ${WITHIN_METRICS}
  UNION ALL
  SELECT TimeUnix FROM metrics_sum WHERE ${WITHIN_METRICS}
)
GROUP BY ts
ORDER BY ts`,
          ),
          "service-count": stat(
            "Reporting services",
            { calculation: "last" },
            `SELECT uniqExact(ServiceName) AS services FROM (
  SELECT ServiceName FROM metrics_gauge WHERE ${WITHIN_METRICS}
  UNION ALL
  SELECT ServiceName FROM metrics_sum WHERE ${WITHIN_METRICS}
)`,
          ),
          selected: timeSeries(
            "Selected metrics",
            { showLegend: true },
            `SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
       MetricName,
       avg(Value) AS value
FROM (
  SELECT TimeUnix, MetricName, Value FROM metrics_gauge WHERE ${WITHIN_METRICS} AND MetricName IN $metric
  UNION ALL
  SELECT TimeUnix, MetricName, Value FROM metrics_sum WHERE ${WITHIN_METRICS} AND MetricName IN $metric
)
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
FROM (
  SELECT MetricName, MetricUnit, MetricDescription, ServiceName FROM metrics_gauge WHERE ${WITHIN_METRICS}
  UNION ALL
  SELECT MetricName, MetricUnit, MetricDescription, ServiceName FROM metrics_sum WHERE ${WITHIN_METRICS}
)
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
      "Event-loop delay, V8 heap and process CPU for Node services running the OpenTelemetry runtime instrumentation.",
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
          "eventloop-delay": metricLine(
            "Event-loop delay P99",
            "nodejs.eventloop.delay.p99",
            { unit: "ms", scale: "* 1000", aggregate: "max" },
          ),
          "eventloop-utilization": metricLine(
            "Event-loop utilization",
            "nodejs.eventloop.utilization",
            { unit: "%", scale: "* 100" },
          ),
          "heap-used": metricLine("V8 heap used", "v8js.memory.heap.used", {
            unit: "MB",
            scale: "/ 1048576",
            seriesBy: "v8js.heap.space.name",
          }),
          "gc-duration": metricLine("GC duration", "v8js.gc.duration", {
            unit: "s",
            aggregate: "max",
          }),
        },
        layouts: layout([
          split(8, "eventloop-delay", "eventloop-utilization"),
          split(8, "heap-used", "gc-duration"),
        ]),
      },
    },
  },
];
