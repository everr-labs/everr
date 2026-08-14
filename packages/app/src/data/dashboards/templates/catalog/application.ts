import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { DashboardTemplate } from "../types";
import {
  BUCKET,
  errorRateStat,
  needsSpanAttribute,
  needsTraces,
  OF_SERVICE,
  p95LatencyStat,
  SERIES_BUCKET,
  serviceVariable,
  topSeries,
  WITHIN,
} from "./shared";

export const applicationTemplates: DashboardTemplate[] = [
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
          "error-rate": errorRateStat(
            " AND SpanAttributes['rpc.system'] != ''",
          ),
          "p95-latency": p95LatencyStat(
            "P95 latency",
            " AND SpanAttributes['rpc.system'] != ''",
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
];
