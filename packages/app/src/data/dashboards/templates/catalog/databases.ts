import type { Panel } from "../../schema";
import { layout, split } from "../build";
import type { DashboardTemplate, TemplateCategory } from "../types";
import { metricLine, needsMetricNamespace, needsMetrics } from "./shared";

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

export const databaseTemplates: DashboardTemplate[] = [
  receiverTemplate({
    id: "postgres-overview",
    name: "Postgres Overview",
    description:
      "Connections, commit and rollback throughput, cache behavior and database size, from the OpenTelemetry postgresql receiver.",
    category: "Databases",
    namespace: "postgresql",
    panels: {
      backends: metricLine("Active connections", "postgresql.backends", {
        seriesBy: "postgresql.database.name",
      }),
      commits: metricLine("Commits", "postgresql.commits", {
        aggregate: "max",
        seriesBy: "postgresql.database.name",
      }),
      rollbacks: metricLine("Rollbacks", "postgresql.rollbacks", {
        aggregate: "max",
        seriesBy: "postgresql.database.name",
      }),
      "blocks-read": metricLine("Blocks read", "postgresql.blocks_read", {
        aggregate: "max",
        seriesBy: "source",
      }),
      deadlocks: metricLine("Deadlocks", "postgresql.deadlocks", {
        aggregate: "max",
      }),
      "db-size": metricLine("Database size", "postgresql.db_size", {
        unit: "MB",
        scale: "/ 1048576",
        seriesBy: "postgresql.database.name",
      }),
    },
  }),

  receiverTemplate({
    id: "mysql-overview",
    name: "MySQL Overview",
    description:
      "Threads, operation mix, buffer-pool usage and lock pressure, from the OpenTelemetry mysql receiver.",
    category: "Databases",
    namespace: "mysql",
    panels: {
      threads: metricLine("Threads", "mysql.threads", { seriesBy: "kind" }),
      operations: metricLine("Operations", "mysql.operations", {
        aggregate: "max",
        seriesBy: "operation",
      }),
      "buffer-pool": metricLine(
        "Buffer pool usage",
        "mysql.buffer_pool.usage",
        { unit: "MB", scale: "/ 1048576", seriesBy: "status" },
      ),
      locks: metricLine("Row locks", "mysql.locks", { aggregate: "max" }),
    },
  }),

  receiverTemplate({
    id: "redis-overview",
    name: "Redis Overview",
    description:
      "Command throughput, memory, connected clients and keyspace hit rate, from the OpenTelemetry redis receiver.",
    category: "Databases",
    namespace: "redis",
    panels: {
      commands: metricLine("Commands processed", "redis.commands.processed", {
        aggregate: "max",
      }),
      memory: metricLine("Memory used", "redis.memory.used", {
        unit: "MB",
        scale: "/ 1048576",
      }),
      clients: metricLine("Connected clients", "redis.clients.connected"),
      hits: metricLine("Keyspace hits", "redis.keyspace.hits", {
        aggregate: "max",
      }),
      misses: metricLine("Keyspace misses", "redis.keyspace.misses", {
        aggregate: "max",
      }),
      evictions: metricLine("Evicted keys", "redis.keys.evicted", {
        aggregate: "max",
      }),
    },
  }),

  receiverTemplate({
    id: "mongodb-overview",
    name: "MongoDB Overview",
    description:
      "Operation counts, connections, cache behavior and memory, from the OpenTelemetry mongodb receiver.",
    category: "Databases",
    namespace: "mongodb",
    panels: {
      operations: metricLine("Operations", "mongodb.operation.count", {
        aggregate: "max",
        seriesBy: "operation",
      }),
      connections: metricLine("Connections", "mongodb.connection.count", {
        seriesBy: "type",
      }),
      cache: metricLine("Cache operations", "mongodb.cache.operations", {
        aggregate: "max",
        seriesBy: "type",
      }),
      memory: metricLine("Memory usage", "mongodb.memory.usage", {
        unit: "MB",
        scale: "/ 1048576",
        seriesBy: "type",
      }),
    },
  }),
];
