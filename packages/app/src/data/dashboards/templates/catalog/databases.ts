import { layout, split, stat, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  metricCounter,
  metricLine,
  metricUnion,
  needsMetricNamespace,
  needsMetrics,
  receiverTemplate,
  SERIES_BUCKET,
} from "./shared";

/**
 * Where the postgresql receiver keeps the database name. Its legacy model emits
 * one resource per database and carries the name as a *resource* attribute; the
 * `receiver.postgresql.useOTelSemconv` gate moves it onto the datapoint as
 * `db.namespace`. Reading both means the board works either side of that gate.
 */
const DB_NAME = `coalesce(nullIf(Attributes['db.namespace'], ''), nullIf(ResourceAttributes['postgresql.database.name'], ''), 'unknown')`;

/**
 * Cache hit ratio, from the one metric the receiver enables by default. Its
 * `source` attribute splits block reads into those served from shared buffers
 * (`heap_hit`, `idx_hit`, `toast_hit`, `tidx_hit`) and those that went to disk,
 * so the ratio falls out of a single counter rather than needing the optional
 * `postgresql.blks_hit` and `postgresql.blks_read` pair the exporter exposes.
 */
const cacheHit = (bucket?: string) => {
  const grouped = bucket ? `${bucket} AS ts, ` : "";
  return `SELECT ${bucket ? "ts, " : ""}sum(hits) / nullIf(sum(hits) + sum(reads), 0) * 100 AS pct
FROM (
  SELECT ${grouped}Attributes['source'] AS source,
         ResourceAttributes AS resource, Attributes AS attrs,
         max(Value) - min(Value) AS delta,
         if(endsWith(source, '_hit'), delta, 0) AS hits,
         if(endsWith(source, '_read'), delta, 0) AS reads
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Attributes, Value", " AND MetricName = 'postgresql.blocks_read'")})
  GROUP BY ${bucket ? "ts, " : ""}source, resource, attrs
)${bucket ? "\nGROUP BY ts\nORDER BY ts" : ""}`;
};

export const databaseTemplates: DashboardTemplate[] = [
  {
    id: "postgres-overview",
    name: "Postgres Overview",
    description:
      "Connections against the server limit, transaction and row-operation throughput, buffer cache behavior, checkpoint cost and database size, from the OpenTelemetry postgresql receiver.",
    category: "Databases",
    requires: [needsMetrics, needsMetricNamespace("postgresql")],
    document: {
      kind: "Dashboard",
      metadata: { name: "postgres-overview" },
      spec: {
        display: { name: "Postgres Overview" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          connections: stat(
            "Connections",
            { calculation: "last", decimals: 0, sparkline: true },
            // Summed across databases per scrape before any bucket average:
            // the legacy resource model reports backends once per database, so
            // averaging the raw value would report a typical database rather
            // than the server.
            `SELECT ts, avg(total) AS backends
FROM (
  SELECT ${BUCKET("TimeUnix")} AS ts, TimeUnix, sum(Value) AS total
  FROM (${metricUnion("TimeUnix, Value", " AND MetricName = 'postgresql.backends'")})
  GROUP BY ts, TimeUnix
)
GROUP BY ts
ORDER BY ts`,
          ),
          "max-connections": stat(
            "Max connections",
            { calculation: "last", decimals: 0 },
            // nullIf, because max() over no rows returns 0 for a non-nullable
            // column and the tile would read a settings value of zero rather
            // than admitting it has nothing.
            `SELECT nullIf(max(Value), 0) AS max_connections
FROM (${metricUnion("Value", " AND MetricName = 'postgresql.connection.max'")})`,
            "The server's max_connections setting. Read Connections against it.",
          ),
          databases: stat(
            "Databases",
            { calculation: "last", decimals: 0 },
            `SELECT nullIf(max(Value), 0) AS databases
FROM (${metricUnion("Value", " AND MetricName = 'postgresql.database.count'")})`,
          ),
          "cache-hit": stat(
            "Cache hit rate",
            { calculation: "last", unit: "%", decimals: 1 },
            cacheHit(),
            "Share of block reads served from shared buffers over the window.",
          ),
          "connections-by-database": metricLine(
            "Connections by database",
            "postgresql.backends",
            { seriesExpr: DB_NAME },
          ),
          transactions: timeSeries(
            "Transactions",
            { unit: "", showLegend: true },
            // Two metric names rather than one metric with a result attribute,
            // so they are unioned into a labelled series to share a chart the
            // way the reference puts commit and rollback rate side by side.
            `SELECT ts, series, sum(delta) AS value
FROM (
  SELECT ${SERIES_BUCKET("TimeUnix")} AS ts,
         if(MetricName = 'postgresql.commits', 'commits', 'rollbacks') AS series,
         ResourceAttributes AS resource, Attributes AS attrs,
         max(Value) - min(Value) AS delta
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Attributes, MetricName, Value", " AND MetricName IN ('postgresql.commits', 'postgresql.rollbacks')")})
  GROUP BY ts, series, resource, attrs
)
GROUP BY ts, series
ORDER BY ts`,
            "Committed and rolled back per bucket. A rollback line tracking commits is usually an application error path, not a database fault.",
          ),
          operations: metricCounter("Row operations", "postgresql.operations", {
            seriesBy: "operation",
            stacked: true,
            description:
              "Rows inserted, updated, deleted and HOT-updated. A high hot_upd share is cheap; a low one means index maintenance on every update.",
          }),
          "cache-hit-over-time": timeSeries(
            "Cache hit rate over time",
            { unit: "%", showLegend: false },
            cacheHit(BUCKET("TimeUnix")),
          ),
          "blocks-read": metricCounter(
            "Block reads",
            "postgresql.blocks_read",
            {
              seriesBy: "source",
            },
          ),
          "db-size": metricLine("Database size", "postgresql.db_size", {
            unit: "MB",
            scale: "/ 1048576",
            seriesExpr: DB_NAME,
          }),
          "bgwriter-buffers": metricCounter(
            "Buffers written",
            "postgresql.bgwriter.buffers.writes",
            {
              seriesBy: "source",
              stacked: true,
              description:
                "Who flushed the buffer. A large backend share means the background writer and checkpointer are not keeping up.",
            },
          ),
          "checkpoint-duration": metricCounter(
            "Checkpoint time",
            "postgresql.bgwriter.duration",
            { unit: "s", scale: "/ 1000", seriesBy: "type" },
          ),
          deadlocks: metricCounter("Deadlocks", "postgresql.deadlocks", {
            description:
              "Optional in the receiver, so this stays empty unless postgresql.deadlocks is enabled in its metrics config.",
          }),
        },
        layouts: layout([
          split(5, "connections", "max-connections", "databases", "cache-hit"),
          split(8, "connections-by-database", "transactions"),
          split(8, "operations", "cache-hit-over-time"),
          split(8, "blocks-read", "db-size"),
          split(8, "bgwriter-buffers", "checkpoint-duration"),
          split(7, "deadlocks"),
        ]),
      },
    },
  },

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
