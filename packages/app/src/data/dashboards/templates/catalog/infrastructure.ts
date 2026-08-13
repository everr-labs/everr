import type { DashboardTemplate } from "../types";
import { metricLine, receiverTemplate } from "./shared";

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

  receiverTemplate({
    id: "kubernetes-workloads",
    name: "Kubernetes Workloads",
    description:
      "Pod CPU, memory, network and restart counts, from the OpenTelemetry kubeletstats receiver.",
    category: "Infrastructure",
    namespace: "k8s",
    panels: {
      "pod-cpu": metricLine("Pod CPU", "k8s.pod.cpu.utilization", {
        unit: "%",
        scale: "* 100",
        seriesBy: "k8s.pod.name",
      }),
      "pod-memory": metricLine("Pod memory", "k8s.pod.memory.usage", {
        unit: "MB",
        scale: "/ 1048576",
        seriesBy: "k8s.pod.name",
      }),
      "pod-network": metricLine("Pod network I/O", "k8s.pod.network.io", {
        unit: "MB",
        scale: "/ 1048576",
        aggregate: "max",
        seriesBy: "direction",
      }),
      restarts: metricLine("Container restarts", "k8s.container.restarts", {
        aggregate: "max",
        seriesBy: "k8s.container.name",
      }),
    },
  }),

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
