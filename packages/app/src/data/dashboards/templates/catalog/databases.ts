import type { DashboardTemplate } from "../types";
import { metricLine, receiverTemplate } from "./shared";

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
