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

/**
 * The current HTTP semantic conventions, spelled once. Every panel below reads
 * these and never the retired `http.method` / `http.status_code` /
 * `http.target`, which an older SDK may still emit alongside them.
 * https://opentelemetry.io/docs/specs/semconv/http/http-spans/
 */
const METHOD = "SpanAttributes['http.request.method']";
const STATUS = "toUInt16OrZero(SpanAttributes['http.response.status_code'])";

/**
 * The low-cardinality grouping key semconv asks for, with fallbacks. A server
 * span carries `http.route` once the framework knows its route table; before
 * that, `url.path` is the only thing describing what was called.
 */
const ROUTE = `coalesce(nullIf(SpanAttributes['http.route'], ''), nullIf(SpanAttributes['url.path'], ''), SpanName)`;

/** Who an outbound call went to. Required on client spans by semconv. */
const HOST = `coalesce(nullIf(SpanAttributes['server.address'], ''), SpanName)`;

/**
 * Span kind is the whole inbound/outbound split: the same attributes describe
 * traffic this service served and calls it made, and only `SpanKind` says
 * which. Reading them together, as the template used to, charts a service's
 * own latency and its dependencies' latency as one line.
 */
const INBOUND = `${WITHIN} AND ${OF_SERVICE} AND SpanKind = 'Server' AND ${METHOD} != ''`;
const OUTBOUND = `${WITHIN} AND ${OF_SERVICE} AND SpanKind = 'Client' AND ${METHOD} != ''`;

/** Status class, as 19419 splits its request counts: 2xx / 3xx / 4xx / 5xx. */
const STATUS_CLASS = `concat(toString(intDiv(${STATUS}, 100)), 'xx')`;

export const applicationTemplates: DashboardTemplate[] = [
  {
    id: "http-endpoints",
    name: "HTTP Endpoints",
    description:
      "HTTP traffic by route, split into inbound requests this service served and outbound calls it made: volume, status classes, and the routes that are slowest or failing most.",
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
WHERE ${INBOUND}
GROUP BY ts
ORDER BY ts`,
          ),
          "server-errors": stat(
            "5xx rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(${STATUS} >= 500) / count() * 100 AS pct
FROM traces
WHERE ${INBOUND}`,
          ),
          "client-errors": stat(
            "4xx rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(5, 20),
            },
            `SELECT countIf(${STATUS} BETWEEN 400 AND 499) / count() * 100 AS pct
FROM traces
WHERE ${INBOUND}`,
          ),
          "p95-latency": stat(
            "P95 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${INBOUND}`,
          ),
          "by-status": timeSeries(
            "Requests by status class",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${STATUS_CLASS} AS status_class,
       count() AS requests
FROM traces
WHERE ${INBOUND} AND SpanAttributes['http.response.status_code'] != ''
GROUP BY ts, status_class
ORDER BY ts`,
          ),
          "by-route": timeSeries(
            "Requests by route",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${ROUTE} AS route,
       count() AS requests
FROM traces
WHERE ${INBOUND}
  AND ${topSeries(ROUTE, "traces", INBOUND)}
GROUP BY ts, route
ORDER BY ts`,
            "The eight busiest routes over the range. Quieter routes are in the tables below.",
          ),
          "latency-by-route": timeSeries(
            "P95 latency by route",
            { showLegend: true, unit: "ms" },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${ROUTE} AS route,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${INBOUND}
  AND ${topSeries(ROUTE, "traces", INBOUND)}
GROUP BY ts, route
ORDER BY ts`,
          ),
          "slowest-routes": table(
            "Slowest routes",
            `SELECT ${ROUTE} AS route,
       ${METHOD} AS method,
       count() AS requests,
       round(avg(Duration) / 1000000, 1) AS avg_ms,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
       round(quantile(0.99)(Duration) / 1000000, 1) AS p99_ms
FROM traces
WHERE ${INBOUND}
GROUP BY route, method
ORDER BY p95_ms DESC
LIMIT 30`,
            "Ranked by P95. Low-traffic routes can top this list.",
          ),
          "time-by-route": table(
            "Time spent by route",
            `SELECT ${ROUTE} AS route,
       ${METHOD} AS method,
       count() AS requests,
       round(sum(Duration) / 1000000000, 2) AS total_seconds,
       round(sum(Duration) / (SELECT sum(Duration) FROM traces WHERE ${INBOUND}) * 100, 1) AS share_pct
FROM traces
WHERE ${INBOUND}
GROUP BY route, method
ORDER BY total_seconds DESC
LIMIT 30`,
            "Total request time, not per-request time. Where the service actually spends its day.",
          ),
          "failing-routes": table(
            "Failing routes",
            `SELECT ${ROUTE} AS route,
       ${METHOD} AS method,
       countIf(${STATUS} >= 500) AS server_errors,
       countIf(${STATUS} BETWEEN 400 AND 499) AS client_errors,
       count() AS requests,
       anyIf(SpanAttributes['http.response.status_code'], ${STATUS} >= 400) AS sample_status
FROM traces
WHERE ${INBOUND}
GROUP BY route, method
HAVING server_errors + client_errors > 0
ORDER BY server_errors DESC, client_errors DESC
LIMIT 30`,
          ),
          "outbound-calls": stat(
            "Outbound calls",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS calls
FROM traces
WHERE ${OUTBOUND}
GROUP BY ts
ORDER BY ts`,
          ),
          "outbound-errors": stat(
            "Outbound 5xx rate",
            {
              calculation: "last",
              unit: "%",
              decimals: 2,
              thresholds: thresholds(1, 5),
            },
            `SELECT countIf(${STATUS} >= 500) / count() * 100 AS pct
FROM traces
WHERE ${OUTBOUND}`,
          ),
          "outbound-p95": stat(
            "Outbound P95 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.95)(Duration) / 1000000, 1) AS p95
FROM traces
WHERE ${OUTBOUND}`,
          ),
          "outbound-by-host": timeSeries(
            "Outbound calls by host",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${HOST} AS host,
       count() AS calls
FROM traces
WHERE ${OUTBOUND}
  AND ${topSeries(HOST, "traces", OUTBOUND)}
GROUP BY ts, host
ORDER BY ts`,
          ),
          "outbound-by-status": timeSeries(
            "Outbound calls by status class",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${STATUS_CLASS} AS status_class,
       count() AS calls
FROM traces
WHERE ${OUTBOUND} AND SpanAttributes['http.response.status_code'] != ''
GROUP BY ts, status_class
ORDER BY ts`,
          ),
          dependencies: table(
            "Dependencies",
            `SELECT ${HOST} AS host,
       ${METHOD} AS method,
       count() AS calls,
       countIf(${STATUS} >= 400) AS errors,
       round(avg(Duration) / 1000000, 1) AS avg_ms,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${OUTBOUND}
GROUP BY host, method
ORDER BY calls DESC
LIMIT 30`,
            "Every host this service called, ranked by call volume.",
          ),
        },
        layouts: layout([
          split(5, "requests", "server-errors", "client-errors", "p95-latency"),
          split(8, "by-status", "by-route"),
          split(8, "latency-by-route"),
          split(9, "slowest-routes", "time-by-route"),
          split(9, "failing-routes"),
          split(5, "outbound-calls", "outbound-errors", "outbound-p95"),
          split(8, "outbound-by-host", "outbound-by-status"),
          split(9, "dependencies"),
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
