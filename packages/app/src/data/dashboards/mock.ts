import type { Dashboard } from "./types";

export const MOCK_DASHBOARD: Dashboard = {
  kind: "Dashboard",
  metadata: {
    name: "default",
  },
  spec: {
    display: {
      name: "Overview Dashboard",
      description: "Key metrics at a glance",
    },
    duration: "24h",
    refreshInterval: "30s",
    panels: {
      requestRate: {
        kind: "Panel",
        spec: {
          display: {
            name: "Request Rate",
            description: "Incoming requests per second",
          },
          plugin: { kind: "TimeSeriesChart", spec: {} },
        },
      },
      errorRate: {
        kind: "Panel",
        spec: {
          display: {
            name: "Error Rate",
            description: "5xx error percentage over time",
          },
          plugin: { kind: "TimeSeriesChart", spec: {} },
        },
      },
      totalRequests: {
        kind: "Panel",
        spec: {
          display: {
            name: "Total Requests",
          },
          plugin: { kind: "StatChart", spec: {} },
        },
      },
      p99Latency: {
        kind: "Panel",
        spec: {
          display: {
            name: "P99 Latency",
          },
          plugin: { kind: "StatChart", spec: {} },
        },
      },
      topEndpoints: {
        kind: "Panel",
        spec: {
          display: {
            name: "Top Endpoints",
            description: "Busiest endpoints by request count",
          },
          plugin: { kind: "Table", spec: {} },
        },
      },
    },
    layouts: [
      {
        kind: "Grid",
        spec: {
          display: { title: "Overview" },
          items: [
            {
              x: 0,
              y: 0,
              width: 12,
              height: 8,
              content: { $ref: "#/spec/panels/requestRate" },
            },
            {
              x: 12,
              y: 0,
              width: 12,
              height: 8,
              content: { $ref: "#/spec/panels/errorRate" },
            },
            {
              x: 0,
              y: 8,
              width: 6,
              height: 4,
              content: { $ref: "#/spec/panels/totalRequests" },
            },
            {
              x: 6,
              y: 8,
              width: 6,
              height: 4,
              content: { $ref: "#/spec/panels/p99Latency" },
            },
            {
              x: 12,
              y: 8,
              width: 12,
              height: 8,
              content: { $ref: "#/spec/panels/topEndpoints" },
            },
          ],
        },
      },
    ],
  },
};
