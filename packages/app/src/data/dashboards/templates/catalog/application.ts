import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  needsSpanAttribute,
  needsTraces,
  OF_SERVICE,
  SERIES_BUCKET,
  serviceVariable,
  topSeries,
  WITHIN,
} from "./shared";

export const applicationTemplates: DashboardTemplate[] = [
  {
    id: "service-health",
    name: "Service Health",
    description:
      "Throughput, error rate and P50/P95 latency for one service or all of them. The board to open first when something feels wrong.",
    category: "Application",
    requires: [needsTraces],
    document: {
      kind: "Dashboard",
      metadata: { name: "service-health" },
      spec: {
        display: { name: "Service Health" },
        duration: "1h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          throughput: stat(
            "Throughput",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS spans
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND ParentSpanId = ''
GROUP BY ts
ORDER BY ts`,
            "Root spans, so one request counts once.",
          ),
          "error-rate": stat(
            "Error rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(StatusCode = 'Error') / count() * 100 AS error_pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}`,
          ),
          "p50-latency": stat(
            "P50 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.5)(Duration) / 1000000, 1) AS p50
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND ParentSpanId = ''`,
          ),
          "p95-latency": stat(
            "P95 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND ParentSpanId = ''`,
          ),
          "throughput-over-time": timeSeries(
            "Throughput over time",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ServiceName, count() AS spans
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND ParentSpanId = ''
  AND ${topSeries("ServiceName", "traces", `${WITHIN} AND ${OF_SERVICE}`)}
GROUP BY ts, ServiceName
ORDER BY ts`,
          ),
          "error-rate-over-time": timeSeries(
            "Error rate over time",
            { unit: "%", showLegend: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ServiceName,
       countIf(StatusCode = 'Error') / count() * 100 AS error_pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND ${topSeries("ServiceName", "traces", `${WITHIN} AND ${OF_SERVICE}`)}
GROUP BY ts, ServiceName
ORDER BY ts`,
          ),
          "latency-over-time": timeSeries(
            "P95 latency over time",
            { unit: "ms", showLegend: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ServiceName,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND ParentSpanId = ''
  AND ${topSeries("ServiceName", "traces", `${WITHIN} AND ${OF_SERVICE}`)}
GROUP BY ts, ServiceName
ORDER BY ts`,
          ),
        },
        layouts: layout([
          split(5, "throughput", "error-rate", "p50-latency", "p95-latency"),
          split(8, "throughput-over-time", "error-rate-over-time"),
          split(8, "latency-over-time"),
        ]),
      },
    },
  },

  {
    id: "top-errors",
    name: "Top Errors",
    description:
      "Exceptions grouped by type and normalized message, ranked by how often they fire, each with a sample trace to open.",
    category: "Application",
    requires: [needsTraces],
    document: {
      kind: "Dashboard",
      metadata: { name: "top-errors" },
      spec: {
        display: { name: "Top Errors" },
        duration: "24h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          "error-spans": stat(
            "Error spans",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS errors
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND StatusCode = 'Error'
GROUP BY ts
ORDER BY ts`,
          ),
          "error-groups": stat(
            "Distinct groups",
            { calculation: "last" },
            `SELECT uniqExact(
         ev.2['exception.type'],
         replaceRegexpAll(substring(ev.2['exception.message'], 1, 200), '[0-9]+([.][0-9]+)?', 'N')
       ) AS groups
FROM traces ARRAY JOIN arrayZip(Events.Name, Events.Attributes) AS ev
WHERE ${WITHIN} AND ${OF_SERVICE} AND ev.1 = 'exception'`,
            "Unique exception type plus normalized message.",
          ),
          "error-rate": stat(
            "Error rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(StatusCode = 'Error') / count() * 100 AS error_pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}`,
          ),
          "errors-over-time": timeSeries(
            "Error spans by service",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ServiceName, count() AS errors
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND StatusCode = 'Error'
  AND ${topSeries("ServiceName", "traces", `${WITHIN} AND ${OF_SERVICE} AND StatusCode = 'Error'`)}
GROUP BY ts, ServiceName
ORDER BY ts`,
          ),
          "top-groups": table(
            "Top error groups",
            `SELECT ev.2['exception.type'] AS type,
       replaceRegexpAll(substring(ev.2['exception.message'], 1, 200), '[0-9]+([.][0-9]+)?', 'N') AS message,
       count() AS occurrences,
       arrayStringConcat(groupUniqArray(ServiceName), ', ') AS services,
       formatDateTime(min(Timestamp), '%Y-%m-%d %H:%i') AS first_seen,
       formatDateTime(max(Timestamp), '%Y-%m-%d %H:%i') AS last_seen,
       argMax(TraceId, Timestamp) AS sample_trace
FROM traces ARRAY JOIN arrayZip(Events.Name, Events.Attributes) AS ev
WHERE ${WITHIN} AND ${OF_SERVICE} AND ev.1 = 'exception'
GROUP BY type, message
ORDER BY occurrences DESC
LIMIT 50`,
            "Open the sample trace to investigate one occurrence.",
          ),
          "failing-operations": table(
            "Failing operations",
            `SELECT ServiceName AS service,
       SpanName AS operation,
       countIf(StatusCode = 'Error') AS errors,
       round(countIf(StatusCode = 'Error') / count() * 100, 1) AS error_pct,
       formatDateTime(maxIf(Timestamp, StatusCode = 'Error'), '%Y-%m-%d %H:%i') AS last_seen
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
GROUP BY service, operation
HAVING errors > 0
ORDER BY errors DESC
LIMIT 30`,
            "Includes failures that carry no exception event.",
          ),
        },
        layouts: layout([
          split(5, "error-spans", "error-groups", "error-rate"),
          split(8, "errors-over-time"),
          split(10, "top-groups"),
          split(9, "failing-operations"),
        ]),
      },
    },
  },

  {
    id: "http-endpoints",
    name: "HTTP Endpoints",
    description:
      "Server-side HTTP traffic by route: volume, status classes, and the routes that are slowest or failing most.",
    category: "Application",
    requires: [needsTraces, needsSpanAttribute("http.request.method")],
    document: {
      kind: "Dashboard",
      metadata: { name: "http-endpoints" },
      spec: {
        display: { name: "HTTP Endpoints" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          requests: stat(
            "Requests",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS requests
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.request.method'] != ''
GROUP BY ts
ORDER BY ts`,
          ),
          "failed-requests": stat(
            "5xx rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(toUInt16OrZero(SpanAttributes['http.response.status_code']) >= 500) / count() * 100 AS pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.request.method'] != ''`,
          ),
          "p95-latency": stat(
            "P95 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.request.method'] != ''`,
          ),
          "by-status": timeSeries(
            "Requests by status class",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       concat(substring(SpanAttributes['http.response.status_code'], 1, 1), 'xx') AS status_class,
       count() AS requests
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.response.status_code'] != ''
GROUP BY ts, status_class
ORDER BY ts`,
          ),
          "slowest-routes": table(
            "Slowest routes",
            `SELECT coalesce(nullIf(SpanAttributes['http.route'], ''), SpanName) AS route,
       SpanAttributes['http.request.method'] AS method,
       count() AS requests,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
       round(quantile(0.99)(Duration) / 1000000, 1) AS p99_ms
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.request.method'] != ''
GROUP BY route, method
ORDER BY p95_ms DESC
LIMIT 30`,
            "Ranked by P95. Low-traffic routes can top this list.",
          ),
          "failing-routes": table(
            "Failing routes",
            `SELECT coalesce(nullIf(SpanAttributes['http.route'], ''), SpanName) AS route,
       SpanAttributes['http.request.method'] AS method,
       countIf(toUInt16OrZero(SpanAttributes['http.response.status_code']) >= 500) AS server_errors,
       countIf(toUInt16OrZero(SpanAttributes['http.response.status_code']) BETWEEN 400 AND 499) AS client_errors,
       count() AS requests
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['http.request.method'] != ''
GROUP BY route, method
HAVING server_errors + client_errors > 0
ORDER BY server_errors DESC, client_errors DESC
LIMIT 30`,
          ),
        },
        layouts: layout([
          split(5, "requests", "failed-requests", "p95-latency"),
          split(8, "by-status"),
          split(9, "slowest-routes", "failing-routes"),
        ]),
      },
    },
  },

  {
    id: "grpc-service",
    name: "gRPC Service",
    description:
      "RPC call volume, status codes and latency per method, for services instrumented with the gRPC semantic conventions.",
    category: "Application",
    requires: [needsTraces, needsSpanAttribute("rpc.system")],
    document: {
      kind: "Dashboard",
      metadata: { name: "grpc-service" },
      spec: {
        display: { name: "gRPC Service" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          calls: stat(
            "Calls",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS calls
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''
GROUP BY ts
ORDER BY ts`,
          ),
          "error-rate": stat(
            "Error rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(StatusCode = 'Error') / count() * 100 AS error_pct
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''`,
          ),
          "p95-latency": stat(
            "P95 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''`,
          ),
          "calls-by-method": timeSeries(
            "Calls by method",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       concat(SpanAttributes['rpc.service'], '/', SpanAttributes['rpc.method']) AS method,
       count() AS calls
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''
  AND ${topSeries(
    "concat(SpanAttributes['rpc.service'], '/', SpanAttributes['rpc.method'])",
    "traces",
    `${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''`,
  )}
GROUP BY ts, method
ORDER BY ts`,
          ),
          methods: table(
            "Methods",
            `SELECT concat(SpanAttributes['rpc.service'], '/', SpanAttributes['rpc.method']) AS method,
       count() AS calls,
       countIf(StatusCode = 'Error') AS errors,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
       anyIf(SpanAttributes['rpc.grpc.status_code'], StatusCode = 'Error') AS sample_status
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['rpc.system'] != ''
GROUP BY method
ORDER BY calls DESC
LIMIT 40`,
          ),
        },
        layouts: layout([
          split(5, "calls", "error-rate", "p95-latency"),
          split(8, "calls-by-method"),
          split(9, "methods"),
        ]),
      },
    },
  },

  {
    id: "database-calls",
    name: "Database Calls",
    description:
      "Outbound database work as your services see it: query volume, latency and the statements that cost the most time.",
    category: "Application",
    requires: [needsTraces, needsSpanAttribute("db.system")],
    document: {
      kind: "Dashboard",
      metadata: { name: "database-calls" },
      spec: {
        display: { name: "Database Calls" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          queries: stat(
            "Queries",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS queries
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['db.system'] != ''
GROUP BY ts
ORDER BY ts`,
          ),
          "p95-latency": stat(
            "P95 query time",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['db.system'] != ''`,
          ),
          "failed-queries": stat(
            "Failed queries",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS failed
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE}
  AND SpanAttributes['db.system'] != '' AND StatusCode = 'Error'
GROUP BY ts
ORDER BY ts`,
          ),
          "by-system": timeSeries(
            "Queries by system",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       SpanAttributes['db.system'] AS system,
       count() AS queries
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['db.system'] != ''
GROUP BY ts, system
ORDER BY ts`,
          ),
          "top-statements": table(
            "Statements by total time",
            `SELECT SpanAttributes['db.system'] AS system,
       coalesce(nullIf(SpanAttributes['db.collection.name'], ''), SpanAttributes['db.namespace']) AS target,
       SpanName AS operation,
       count() AS calls,
       round(sum(Duration) / 1000000000, 2) AS total_seconds,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${WITHIN} AND ${OF_SERVICE} AND SpanAttributes['db.system'] != ''
GROUP BY system, target, operation
ORDER BY total_seconds DESC
LIMIT 30`,
            "Total time, not P95: this is where the wall clock actually goes.",
          ),
        },
        layouts: layout([
          split(5, "queries", "p95-latency", "failed-queries"),
          split(8, "by-system"),
          split(9, "top-statements"),
        ]),
      },
    },
  },
];
