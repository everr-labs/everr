import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  metricCounter,
  metricLine,
  metricUnion,
  needsMetricNamespace,
  needsMetrics,
  receiverTemplate,
  SERIES_BUCKET,
  topSeries,
} from "./shared";

/**
 * Every dimension the kubeletstats receiver reports is a **resource**
 * attribute: the node name, the namespace, the pod and the container all sit on
 * the resource, and nothing but `direction` and `interface` lands on the
 * datapoint. Splitting on `Attributes['k8s.pod.name']` therefore names every
 * series the empty string, which is what the previous board did.
 */
const NODE = `ResourceAttributes['k8s.node.name']`;
const NAMESPACE = `ResourceAttributes['k8s.namespace.name']`;
const POD = `ResourceAttributes['k8s.pod.name']`;

/** Two gauge metrics read against each other as a percentage, over the window. */
const ratioPct = (used: string, total: string[]) =>
  `SELECT round(
         avgIf(Value, MetricName = '${used}')
         / nullIf(${total.map((metric) => `avgIf(Value, MetricName = '${metric}')`).join(" + ")}, 0) * 100, 1) AS pct
FROM (${metricUnion("MetricName, Value", ` AND MetricName IN (${[...new Set([used, ...total])].map((metric) => `'${metric}'`).join(", ")})`)})`;

/** How many distinct values of one resource attribute reported a metric. */
const countOf = (dimension: string, metric: string) =>
  `SELECT nullIf(uniqExact(dimension), 0) AS total
FROM (${metricUnion(`${dimension} AS dimension`, ` AND MetricName = '${metric}'`)})`;

/**
 * A pod-level gauge rolled up to its namespace. The roll-up is two levels, and
 * both are load-bearing: a pod is averaged over the bucket, because several
 * scrapes of one pod are one pod, and the pods are then summed, because a
 * namespace uses what all of its pods use. Averaging straight to the namespace
 * would report the size of an average pod, and summing straight would multiply
 * by the number of scrapes in the bucket.
 *
 * No shared helper expresses that, so the query is written out here, on
 * `SERIES_BUCKET` and the same top-N namespace cap the helpers apply.
 */
const byNamespace = (metric: string, scale = "") =>
  `WITH points AS (${metricUnion(
    `TimeUnix, ${NAMESPACE} AS series, ${POD} AS pod, Value`,
    ` AND MetricName = '${metric}'`,
  )})
SELECT ts, series, sum(pod_value)${scale ? ` ${scale}` : ""} AS value
FROM (
  SELECT ${SERIES_BUCKET("TimeUnix")} AS ts, series, pod,
         avg(Value) AS pod_value
  FROM points
  WHERE ${topSeries("series", "points")}
  GROUP BY ts, series, pod
)
GROUP BY ts, series
ORDER BY ts`;

/** The busiest pods over the window, as the reference ranks them. */
const topPods = (metric: string, column: string, scale = "") =>
  `SELECT namespace, pod, round(avg(Value)${scale ? ` ${scale}` : ""}, 3) AS ${column}
FROM (${metricUnion(`${NAMESPACE} AS namespace, ${POD} AS pod, Value`, ` AND MetricName = '${metric}'`)})
GROUP BY namespace, pod
ORDER BY ${column} DESC
LIMIT 15`;

export const infrastructureTemplates: DashboardTemplate[] = [
  receiverTemplate({
    id: "host-metrics",
    name: "Host Metrics",
    description:
      "CPU, memory, disk and network for the machines your services run on, from the OpenTelemetry hostmetrics receiver.",
    category: "Infrastructure",
    namespace: "system",
    panels: {
      cpu: metricLine("CPU utilization", "system.cpu.utilization", {
        unit: "%",
        scale: "* 100",
        seriesBy: "state",
      }),
      memory: metricLine("Memory usage", "system.memory.usage", {
        unit: "MB",
        scale: "/ 1048576",
        seriesBy: "state",
      }),
      "disk-io": metricLine("Disk I/O", "system.disk.io", {
        unit: "MB",
        scale: "/ 1048576",
        aggregate: "max",
        seriesBy: "direction",
      }),
      "network-io": metricLine("Network I/O", "system.network.io", {
        unit: "MB",
        scale: "/ 1048576",
        aggregate: "max",
        seriesBy: "direction",
      }),
      "filesystem-usage": metricLine(
        "Filesystem usage",
        "system.filesystem.usage",
        {
          unit: "GB",
          scale: "/ 1073741824",
          seriesBy: "state",
        },
      ),
      "load-average": metricLine(
        "Load average (1m)",
        "system.cpu.load_average.1m",
      ),
    },
  }),

  {
    id: "kubernetes-workloads",
    name: "Kubernetes Workloads",
    description:
      "Node CPU, memory and filesystem headroom, the same resources rolled up per namespace, the busiest pods, and pod and node network traffic, from the OpenTelemetry kubeletstats receiver.",
    category: "Infrastructure",
    requires: [needsMetrics, needsMetricNamespace("k8s")],
    document: {
      kind: "Dashboard",
      metadata: { name: "kubernetes-workloads" },
      spec: {
        display: { name: "Kubernetes Workloads" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          nodes: stat(
            "Nodes",
            { calculation: "last", decimals: 0 },
            countOf(NODE, "k8s.node.cpu.usage"),
            "Nodes the kubelet scrape reached.",
          ),
          pods: stat(
            "Pods",
            { calculation: "last", decimals: 0 },
            countOf(POD, "k8s.pod.cpu.usage"),
            "Pods seen over the window.",
          ),
          "node-memory-used": stat(
            "Node memory used",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(75, 90),
            },
            ratioPct("k8s.node.memory.working_set", [
              "k8s.node.memory.working_set",
              "k8s.node.memory.available",
            ]),
            "Working set against what is still free.",
          ),
          "node-filesystem-used": stat(
            "Node filesystem used",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(75, 90),
            },
            ratioPct("k8s.node.filesystem.usage", [
              "k8s.node.filesystem.capacity",
            ]),
            "Averaged across nodes.",
          ),
          "node-cpu": metricLine("Node CPU usage", "k8s.node.cpu.usage", {
            unit: " cores",
            seriesExpr: NODE,
            description:
              "Cores in use per node, as the kubelet reports it. Not a percentage: read it against the cores the node has.",
          }),
          "node-memory": metricLine(
            "Node memory working set",
            "k8s.node.memory.working_set",
            {
              unit: " GiB",
              scale: "/ 1073741824",
              seriesExpr: NODE,
              description:
                "Working set is what the kubelet counts against the node before it evicts, so it is the number that decides eviction, not total memory usage.",
            },
          ),
          "namespace-cpu": timeSeries(
            "CPU by namespace",
            { unit: " cores", showLegend: true, stacked: true },
            byNamespace("k8s.pod.cpu.usage"),
            "Every pod in the namespace, summed. Top namespaces only.",
          ),
          "namespace-memory": timeSeries(
            "Memory by namespace",
            { unit: " GiB", showLegend: true, stacked: true },
            byNamespace("k8s.pod.memory.working_set", "/ 1073741824"),
            "Every pod in the namespace, summed. Top namespaces only.",
          ),
          "top-pods-cpu": table(
            "Top pods by CPU",
            topPods("k8s.pod.cpu.usage", "cpu_cores"),
            "Cores, averaged over the window.",
          ),
          "top-pods-memory": table(
            "Top pods by memory",
            topPods("k8s.pod.memory.working_set", "mem_mib", "/ 1048576"),
            "MiB of working set, averaged over the window.",
          ),
          "pod-network": metricCounter(
            "Pod network I/O",
            "k8s.pod.network.io",
            {
              unit: "MB",
              scale: "/ 1048576",
              seriesBy: "direction",
              description:
                "A cumulative counter, drawn as the bytes moved in each bucket. Summed across pods.",
            },
          ),
          "node-network": metricCounter(
            "Node network I/O",
            "k8s.node.network.io",
            {
              unit: "MB",
              scale: "/ 1048576",
              seriesBy: "direction",
              description:
                "The same traffic seen at the node, so it includes what the pod counters miss.",
            },
          ),
        },
        layouts: layout([
          split(5, "nodes", "pods", "node-memory-used", "node-filesystem-used"),
          split(8, "node-cpu", "node-memory"),
          split(8, "namespace-cpu", "namespace-memory"),
          split(8, "top-pods-cpu", "top-pods-memory"),
          split(8, "pod-network", "node-network"),
        ]),
      },
    },
  },

  receiverTemplate({
    id: "container-metrics",
    name: "Container Metrics",
    description:
      "Per-container CPU, memory and I/O, from the OpenTelemetry docker_stats receiver.",
    category: "Infrastructure",
    namespace: "container",
    panels: {
      cpu: metricLine("CPU utilization", "container.cpu.utilization", {
        unit: "%",
        scale: "* 100",
        seriesBy: "container.name",
      }),
      memory: metricLine("Memory usage", "container.memory.usage.total", {
        unit: "MB",
        scale: "/ 1048576",
        seriesBy: "container.name",
      }),
      "blockio-read": metricLine(
        "Block I/O read",
        "container.blockio.io_service_bytes_recursive",
        {
          unit: "MB",
          scale: "/ 1048576",
          aggregate: "max",
          seriesBy: "operation",
        },
      ),
      network: metricLine(
        "Network received",
        "container.network.io.usage.rx_bytes",
        {
          unit: "MB",
          scale: "/ 1048576",
          aggregate: "max",
          seriesBy: "container.name",
        },
      ),
    },
  }),
];
