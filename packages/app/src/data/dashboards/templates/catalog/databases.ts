import { layout, split, stat, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  metricCounter,
  metricCounterUnion,
  metricLine,
  metricLineUnion,
  metricUnion,
  needsMetricNamespace,
  needsMetrics,
  receiverTemplate,
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

/**
 * The `mysql.handlers` kinds that describe transaction control rather than row
 * access. The receiver puts the whole family on one metric name; the reference
 * splits it in two, and the split is what makes either half readable.
 */
const TRANSACTION_HANDLERS = [
  "commit",
  "rollback",
  "prepare",
  "savepoint",
  "savepoint_rollback",
];

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
          // Two metric names rather than one metric with a result attribute, so
          // the metric name itself labels the series and they share a chart the
          // way the reference puts commit and rollback rate side by side.
          transactions: metricCounterUnion(
            "Transactions",
            {
              commits: "postgresql.commits",
              rollbacks: "postgresql.rollbacks",
            },
            {
              description:
                "Committed and rolled back per bucket. A rollback line tracking commits is usually an application error path, not a database fault.",
            },
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

  {
    id: "mysql-overview",
    name: "MySQL Overview",
    description:
      "Uptime and buffer pool size, thread and connection activity, the command and handler mix behind the query load, and client network traffic, from the OpenTelemetry mysql receiver.",
    category: "Databases",
    requires: [needsMetrics, needsMetricNamespace("mysql")],
    document: {
      kind: "Dashboard",
      metadata: { name: "mysql-overview" },
      spec: {
        display: { name: "MySQL Overview" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          uptime: stat(
            "Uptime",
            { calculation: "last", unit: "d", decimals: 1 },
            `SELECT nullIf(max(Value), 0) / 86400 AS days
FROM (${metricUnion("Value", " AND MetricName = 'mysql.uptime'")})`,
            "A reset here explains a discontinuity in every counter below.",
          ),
          "buffer-pool-size": stat(
            "Buffer pool size",
            { calculation: "last", unit: "MB", decimals: 0 },
            `SELECT nullIf(max(Value), 0) / 1048576 AS mb
FROM (${metricUnion("Value", " AND MetricName = 'mysql.buffer_pool.limit'")})`,
            "Read Buffer pool usage against it.",
          ),
          connections: stat(
            "Connections",
            { calculation: "last", decimals: 0, sparkline: true },
            `SELECT ${BUCKET("TimeUnix")} AS ts, avg(Value) AS connected
FROM (${metricUnion("TimeUnix, Attributes, Value", " AND MetricName = 'mysql.threads' AND Attributes['kind'] = 'connected'")})
GROUP BY ts
ORDER BY ts`,
          ),
          "queries-per-second": stat(
            "Queries per second",
            { calculation: "last", decimals: 1, sparkline: true },
            // The receiver reports no query counter by default, and no default
            // metric stands in for one: handlers and commands count different
            // things. This is the one tile that needs mysql.query.count turned
            // on, and the reference's headline gauge is worth that.
            `SELECT ts, sum(delta) / {step:UInt32} AS qps
FROM (
  SELECT ${BUCKET("TimeUnix")} AS ts,
         ResourceAttributes AS resource, Attributes AS attrs,
         max(Value) - min(Value) AS delta
  FROM (${metricUnion("TimeUnix, ResourceAttributes, Attributes, Value", " AND MetricName = 'mysql.query.count'")})
  GROUP BY ts, resource, attrs
)
GROUP BY ts
ORDER BY ts`,
            "Needs mysql.query.count, which the receiver leaves off.",
          ),
          "thread-activity": metricLine("Thread activity", "mysql.threads", {
            seriesBy: "kind",
            description:
              "Connected is who is attached; running is who is actually working. Running climbing toward connected is the server falling behind.",
          }),
          commands: metricCounter("Top commands", "mysql.commands", {
            seriesBy: "command",
            description:
              "Optional in the receiver, so this stays empty unless mysql.commands is enabled in its metrics config.",
          }),
          handlers: metricCounter("Handlers", "mysql.handlers", {
            seriesBy: "kind",
            seriesNotIn: TRANSACTION_HANDLERS,
            description:
              "How rows were reached. A large read_rnd_next share means table scans rather than index lookups.",
          }),
          "transaction-handlers": metricCounter(
            "Transaction handlers",
            "mysql.handlers",
            {
              seriesBy: "kind",
              seriesIn: TRANSACTION_HANDLERS,
              description:
                "Split from the other handlers because the read handlers are orders of magnitude busier and would flatten these to zero on a shared chart.",
            },
          ),
          "row-operations": metricCounter(
            "Row operations",
            "mysql.row_operations",
            { seriesBy: "operation", stacked: true },
          ),
          "network-io": metricCounter(
            "Client network traffic",
            "mysql.client.network.io",
            {
              unit: "MB",
              scale: "/ 1048576",
              seriesBy: "kind",
              description:
                "Optional in the receiver, so this stays empty unless mysql.client.network.io is enabled in its metrics config.",
            },
          ),
          "buffer-pool-usage": metricLine(
            "Buffer pool usage",
            "mysql.buffer_pool.usage",
            { unit: "MB", scale: "/ 1048576", seriesBy: "status" },
          ),
          "buffer-pool-pages": metricLine(
            "Buffer pool pages",
            "mysql.buffer_pool.pages",
            {
              seriesBy: "kind",
              seriesNotIn: ["total"],
              description:
                "Data, free and misc. Total is left out: it is the sum of the other three and would dwarf them.",
            },
          ),
          "table-locks": metricCounter("Table locks", "mysql.locks", {
            seriesBy: "kind",
            description:
              "Immediate locks were granted at once; waited ones queued. A rising waited line is contention.",
          }),
        },
        layouts: layout([
          split(
            5,
            "uptime",
            "buffer-pool-size",
            "connections",
            "queries-per-second",
          ),
          split(8, "thread-activity", "commands"),
          split(8, "handlers", "transaction-handlers"),
          split(8, "row-operations", "network-io"),
          split(8, "buffer-pool-usage", "buffer-pool-pages"),
          split(7, "table-locks"),
        ]),
      },
    },
  },

  {
    id: "redis-overview",
    name: "Redis Overview",
    description:
      "Command rate and keyspace hit rate, memory against its limit, client and connection activity, key expiry and eviction, from the OpenTelemetry redis receiver.",
    category: "Databases",
    requires: [needsMetrics, needsMetricNamespace("redis")],
    document: {
      kind: "Dashboard",
      metadata: { name: "redis-overview" },
      spec: {
        display: { name: "Redis Overview" },
        duration: "6h",
        refreshInterval: "1m",
        panels: {
          uptime: stat(
            "Uptime",
            { calculation: "last", unit: "d", decimals: 1 },
            `SELECT nullIf(max(Value), 0) / 86400 AS days
FROM (${metricUnion("Value", " AND MetricName = 'redis.uptime'")})`,
            "A reset here explains a discontinuity in every counter below.",
          ),
          "memory-used": stat(
            "Memory used",
            { calculation: "last", unit: "MB", decimals: 1, sparkline: true },
            `SELECT ${BUCKET("TimeUnix")} AS ts, avg(Value) / 1048576 AS mb
FROM (${metricUnion("TimeUnix, Value", " AND MetricName = 'redis.memory.used'")})
GROUP BY ts
ORDER BY ts`,
          ),
          "max-memory": stat(
            "Max memory",
            { calculation: "last", unit: "MB", decimals: 0 },
            // nullIf twice: max() over no rows returns 0 for a non-nullable
            // column, and a Redis with no limit set reports maxmemory as 0.
            // Neither is a limit, and both should read as nothing rather than
            // as a ceiling of zero.
            `SELECT nullIf(max(Value), 0) / 1048576 AS mb
FROM (${metricUnion("Value", " AND MetricName = 'redis.maxmemory'")})`,
            "Needs redis.maxmemory, which the receiver leaves off.",
          ),
          clients: stat(
            "Connected clients",
            { calculation: "last", decimals: 0, sparkline: true },
            `SELECT ${BUCKET("TimeUnix")} AS ts, avg(Value) AS clients
FROM (${metricUnion("TimeUnix, Value", " AND MetricName = 'redis.clients.connected'")})
GROUP BY ts
ORDER BY ts`,
          ),
          "hit-rate": stat(
            "Keyspace hit rate",
            { calculation: "last", unit: "%", decimals: 1 },
            // Both halves are cumulative counters, so the window's ratio comes
            // from their increases, taken per series before they are summed.
            `SELECT sum(hits) / nullIf(sum(hits) + sum(misses), 0) * 100 AS pct
FROM (
  SELECT MetricName, ResourceAttributes AS resource, Attributes AS attrs,
         max(Value) - min(Value) AS delta,
         if(MetricName = 'redis.keyspace.hits', delta, 0) AS hits,
         if(MetricName = 'redis.keyspace.misses', delta, 0) AS misses
  FROM (${metricUnion("MetricName, ResourceAttributes, Attributes, Value", " AND MetricName IN ('redis.keyspace.hits', 'redis.keyspace.misses')")})
  GROUP BY MetricName, resource, attrs
)`,
            "Key lookups that found the key, over the window.",
          ),
          "command-rate": metricLine("Command rate", "redis.commands", {
            description:
              "Operations per second, as the server itself reports it. Not derived from the commands counter.",
          }),
          keyspace: metricCounterUnion(
            "Keyspace hits and misses",
            {
              hits: "redis.keyspace.hits",
              misses: "redis.keyspace.misses",
            },
            {
              description:
                "Lookups that found a key against those that did not. A miss line tracking hits is a cache that is not holding the working set.",
            },
          ),
          memory: metricLineUnion(
            "Memory",
            {
              used: "redis.memory.used",
              rss: "redis.memory.rss",
              peak: "redis.memory.peak",
            },
            {
              unit: "MB",
              scale: "/ 1048576",
              description:
                "Allocated, resident as the OS sees it, and the peak so far. Read used against the Max memory tile.",
            },
          ),
          "network-io": metricCounterUnion(
            "Network I/O",
            { received: "redis.net.input", sent: "redis.net.output" },
            { unit: "MB", scale: "/ 1048576" },
          ),
          "client-activity": metricLineUnion("Client activity", {
            connected: "redis.clients.connected",
            blocked: "redis.clients.blocked",
          }),
          connections: metricCounterUnion(
            "Connections",
            {
              accepted: "redis.connections.received",
              rejected: "redis.connections.rejected",
            },
            {
              description:
                "Any rejected connection is the maxclients limit, not the network.",
            },
          ),
          "keys-by-database": metricLine("Keys by database", "redis.db.keys", {
            seriesBy: "db",
          }),
          "keys-expiring": metricLineUnion(
            "Keys with a TTL",
            { keys: "redis.db.keys", expiring: "redis.db.expires" },
            {
              description:
                "Summed across databases. The gap between the two lines is the keys that never expire on their own, which are the ones eviction has to reclaim.",
            },
          ),
          "expired-evicted": metricCounterUnion(
            "Expired and evicted keys",
            { expired: "redis.keys.expired", evicted: "redis.keys.evicted" },
            {
              description:
                "Expiry is a key reaching its own TTL. Eviction is Redis dropping a key it was still asked to keep, so any eviction at all is memory pressure.",
            },
          ),
          "command-calls": metricCounter("Command calls", "redis.cmd.calls", {
            seriesBy: "cmd",
            description:
              "Needs redis.cmd.calls, which the receiver leaves off. No default metric splits the load by command.",
          }),
        },
        layouts: layout([
          split(
            5,
            "uptime",
            "memory-used",
            "max-memory",
            "clients",
            "hit-rate",
          ),
          split(8, "command-rate", "keyspace"),
          split(8, "memory", "network-io"),
          split(8, "client-activity", "connections"),
          split(8, "keys-by-database", "keys-expiring"),
          split(8, "expired-evicted", "command-calls"),
        ]),
      },
    },
  },

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
