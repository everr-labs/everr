import { layout, split, stat, table, thresholds, timeSeries } from "../build";
import type { BuiltinDashboard } from "../types";
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

/**
 * The current RPC semantic conventions, and only those. `rpc.system`,
 * `rpc.service` and `rpc.grpc.status_code` are all deprecated: `rpc.system`
 * became `rpc.system.name`, `rpc.service` was absorbed into `rpc.method`, which
 * now carries the fully-qualified name, and the gRPC status code became a
 * protocol-agnostic string, so the integer `0` is now `"OK"`.
 *
 * The retired spellings are still what every instrumentation emits by default —
 * the stable set is opt-in behind `OTEL_SEMCONV_STABILITY_OPT_IN=rpc` — so this
 * board draws nothing until an Organization opts in. Reading both anyway would
 * make every number here depend on which SDK version emitted the span, which is
 * the one thing a template must never do.
 * https://opentelemetry.io/docs/specs/semconv/rpc/rpc-spans/
 * https://opentelemetry.io/docs/specs/semconv/non-normative/rpc-migration/
 */
const RPC_SYSTEM = `SpanAttributes['rpc.system.name']`;
const RPC_STATUS = `SpanAttributes['rpc.response.status_code']`;
const ERROR_TYPE = `SpanAttributes['error.type']`;

/**
 * The method, already fully qualified by the current conventions — there is no
 * `rpc.service` left to concatenate. It is Conditionally Required rather than
 * Required, and semconv folds an unrecognized method into the literal `_OTHER`
 * to hold the cardinality down, so the span name is the fallback.
 */
const RPC_METHOD = `coalesce(nullIf(SpanAttributes['rpc.method'], ''), SpanName)`;

/** Which server an outbound call went to. */
const RPC_PEER = `coalesce(nullIf(SpanAttributes['server.address'], ''), SpanName)`;

/**
 * Span kind is the inbound/outbound split here exactly as it is on the HTTP
 * board, and semconv is stricter about it: an RPC client span MUST be `Client`
 * and a server span MUST be `Server`. A span that is neither is not an RPC call
 * this template can place, so both sections exclude it rather than guess.
 */
const IS_RPC = `${RPC_SYSTEM} != ''`;
const RPC_INBOUND = `${WITHIN} AND ${OF_SERVICE} AND ${IS_RPC} AND SpanKind = 'Server'`;
const RPC_OUTBOUND = `${WITHIN} AND ${OF_SERVICE} AND ${IS_RPC} AND SpanKind = 'Client'`;

/**
 * The FaaS attributes are split across the span and the resource, and semconv
 * decides which is which: `faas.trigger`, `faas.invocation_id` and
 * `faas.coldstart` describe *this* invocation and ride on the span, while
 * `faas.name`, `faas.version` and `faas.instance` describe the deployed
 * function and its execution environment, so they ride on the resource.
 * Reading a resource attribute out of `SpanAttributes` returns empty for every
 * row without erroring, which is the trap the Postgres and Kubernetes rebuilds
 * both hit.
 * https://opentelemetry.io/docs/specs/semconv/faas/faas-spans/
 */
const TRIGGER = `SpanAttributes['faas.trigger']`;

/**
 * Which function ran. `faas.name` is the deployed name; `ServiceName` is what
 * the layer defaults it to anyway, and is the only thing present if the
 * function sets `OTEL_SERVICE_NAME` and nothing else.
 */
const FUNCTION = `coalesce(nullIf(ResourceAttributes['faas.name'], ''), ServiceName)`;

/**
 * An OTLP boolean reaches the map as the string the exporter wrote, which is
 * `true` lowercased. A warm invocation may carry `false` or carry nothing at
 * all, so cold is tested for and warm is everything else.
 */
const IS_COLD = `SpanAttributes['faas.coldstart'] = 'true'`;

/**
 * One invocation. `faas.trigger` is Required on the invocation span and appears
 * nowhere else, so unlike the HTTP board this template does not need `SpanKind`
 * to separate work served from work requested — the attribute is already unique
 * to the span that means "the handler ran". It also excludes the per-message
 * Consumer spans an SQS batch produces, which would otherwise multiply the
 * invocation count by the batch size.
 */
const IS_INVOCATION = `${TRIGGER} != ''`;
const INVOCATION = `${WITHIN} AND ${OF_SERVICE} AND ${IS_INVOCATION}`;

export const applicationBuiltins: BuiltinDashboard[] = [
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
    id: "rpc-services",
    name: "RPC Services",
    description:
      "RPC traffic by method, split into inbound calls this service handled and outbound calls it made: volume, status codes, latency, and the methods that are slowest or failing most.",
    category: "Application",
    requires: [needsTraces, needsSpanAttribute("rpc.system.name")],
    document: {
      kind: "Dashboard",
      metadata: { name: "rpc-services" },
      spec: {
        display: { name: "RPC Services" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          calls: stat(
            "Calls",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS calls
FROM traces
WHERE ${RPC_INBOUND}
GROUP BY ts
ORDER BY ts`,
          ),
          "error-rate": errorRateStat(` AND ${IS_RPC} AND SpanKind = 'Server'`),
          "p95-latency": p95LatencyStat(
            "P95 latency",
            ` AND ${IS_RPC} AND SpanKind = 'Server'`,
          ),
          "p99-latency": stat(
            "P99 latency",
            { calculation: "last", unit: "ms", decimals: 1 },
            `SELECT round(quantile(0.99)(Duration) / 1000000, 1) AS p99
FROM traces
WHERE ${RPC_INBOUND}`,
          ),
          "by-status": timeSeries(
            "Calls by status code",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_STATUS} AS status_code,
       count() AS calls
FROM traces
WHERE ${RPC_INBOUND} AND ${RPC_STATUS} != ''
  AND ${topSeries(RPC_STATUS, "traces", `${RPC_INBOUND} AND ${RPC_STATUS} != ''`)}
GROUP BY ts, status_code
ORDER BY ts`,
            "Protocol status, not span status: a gRPC call that returns NOT_FOUND is a completed call.",
          ),
          "by-method": timeSeries(
            "Calls by method",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_METHOD} AS method,
       count() AS calls
FROM traces
WHERE ${RPC_INBOUND}
  AND ${topSeries(RPC_METHOD, "traces", RPC_INBOUND)}
GROUP BY ts, method
ORDER BY ts`,
            "The eight busiest methods over the range. Quieter methods are in the tables below.",
          ),
          "latency-by-method": timeSeries(
            "P95 latency by method",
            { showLegend: true, unit: "ms" },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_METHOD} AS method,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${RPC_INBOUND}
  AND ${topSeries(RPC_METHOD, "traces", RPC_INBOUND)}
GROUP BY ts, method
ORDER BY ts`,
          ),
          "by-system": timeSeries(
            "Calls by RPC system",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_SYSTEM} AS rpc_system,
       count() AS calls
FROM traces
WHERE ${RPC_INBOUND}
  AND ${topSeries(RPC_SYSTEM, "traces", RPC_INBOUND)}
GROUP BY ts, rpc_system
ORDER BY ts`,
            "One line per protocol. A single-protocol service draws one line, which is the expected shape.",
          ),
          "slowest-methods": table(
            "Slowest methods",
            `SELECT ${RPC_METHOD} AS method,
       ${RPC_SYSTEM} AS rpc_system,
       count() AS calls,
       round(avg(Duration) / 1000000, 1) AS avg_ms,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
       round(quantile(0.99)(Duration) / 1000000, 1) AS p99_ms
FROM traces
WHERE ${RPC_INBOUND}
GROUP BY method, rpc_system
ORDER BY p95_ms DESC
LIMIT 30`,
            "Ranked by P95. Low-traffic methods can top this list.",
          ),
          "time-by-method": table(
            "Time spent by method",
            `SELECT ${RPC_METHOD} AS method,
       ${RPC_SYSTEM} AS rpc_system,
       count() AS calls,
       round(sum(Duration) / 1000000000, 2) AS total_seconds,
       round(sum(Duration) / (SELECT sum(Duration) FROM traces WHERE ${RPC_INBOUND}) * 100, 1) AS share_pct
FROM traces
WHERE ${RPC_INBOUND}
GROUP BY method, rpc_system
ORDER BY total_seconds DESC
LIMIT 30`,
            "Total handler time, not per-call time. Where the service actually spends its day.",
          ),
          "failing-methods": table(
            "Failing methods",
            `SELECT ${RPC_METHOD} AS method,
       count() AS calls,
       countIf(StatusCode = 'Error') AS errors,
       anyIf(${RPC_STATUS}, StatusCode = 'Error' AND ${RPC_STATUS} != '') AS sample_status,
       anyIf(${ERROR_TYPE}, ${ERROR_TYPE} != '') AS sample_error
FROM traces
WHERE ${RPC_INBOUND}
GROUP BY method
HAVING errors > 0
ORDER BY errors DESC
LIMIT 30`,
            "error.type is what semconv asks an instrumentation to set on a failed call, so an empty column means it does not set one.",
          ),
          "outbound-calls": stat(
            "Outbound calls",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS calls
FROM traces
WHERE ${RPC_OUTBOUND}
GROUP BY ts
ORDER BY ts`,
          ),
          "outbound-errors": errorRateStat(
            ` AND ${IS_RPC} AND SpanKind = 'Client'`,
          ),
          "outbound-p95": p95LatencyStat(
            "Outbound P95 latency",
            ` AND ${IS_RPC} AND SpanKind = 'Client'`,
          ),
          "outbound-by-peer": timeSeries(
            "Outbound calls by server",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_PEER} AS peer,
       count() AS calls
FROM traces
WHERE ${RPC_OUTBOUND}
  AND ${topSeries(RPC_PEER, "traces", RPC_OUTBOUND)}
GROUP BY ts, peer
ORDER BY ts`,
          ),
          "outbound-by-status": timeSeries(
            "Outbound calls by status code",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${RPC_STATUS} AS status_code,
       count() AS calls
FROM traces
WHERE ${RPC_OUTBOUND} AND ${RPC_STATUS} != ''
  AND ${topSeries(RPC_STATUS, "traces", `${RPC_OUTBOUND} AND ${RPC_STATUS} != ''`)}
GROUP BY ts, status_code
ORDER BY ts`,
          ),
          dependencies: table(
            "Dependencies",
            `SELECT ${RPC_PEER} AS peer,
       ${RPC_METHOD} AS method,
       count() AS calls,
       countIf(StatusCode = 'Error') AS errors,
       round(avg(Duration) / 1000000, 1) AS avg_ms,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${RPC_OUTBOUND}
GROUP BY peer, method
ORDER BY calls DESC
LIMIT 30`,
            "Every RPC server this service called, ranked by call volume.",
          ),
        },
        layouts: layout([
          split(5, "calls", "error-rate", "p95-latency", "p99-latency"),
          split(8, "by-status", "by-method"),
          split(8, "latency-by-method", "by-system"),
          split(9, "slowest-methods", "time-by-method"),
          split(9, "failing-methods"),
          split(5, "outbound-calls", "outbound-errors", "outbound-p95"),
          split(8, "outbound-by-peer", "outbound-by-status"),
          split(9, "dependencies"),
        ]),
      },
    },
  },

  {
    id: "serverless-functions",
    name: "Serverless Functions",
    description:
      "Function invocations from the FaaS semantic conventions: rate, duration percentiles and errors per function, what triggered each invocation, and what a cold start costs.",
    category: "Application",
    requires: [needsTraces, needsSpanAttribute("faas")],
    document: {
      kind: "Dashboard",
      metadata: { name: "serverless-functions" },
      spec: {
        display: { name: "Serverless Functions" },
        duration: "6h",
        refreshInterval: "1m",
        variables: [serviceVariable()],
        panels: {
          invocations: stat(
            "Invocations",
            { calculation: "sum", sparkline: true },
            `SELECT ${BUCKET()} AS ts, count() AS invocations
FROM traces
WHERE ${INVOCATION}
GROUP BY ts
ORDER BY ts`,
          ),
          "error-rate": errorRateStat(` AND ${IS_INVOCATION}`),
          "p95-duration": p95LatencyStat(
            "P95 duration",
            ` AND ${IS_INVOCATION}`,
          ),
          "cold-start-rate": stat(
            "Cold starts",
            {
              calculation: "last",
              unit: "%",
              decimals: 1,
              thresholds: thresholds(5, 20),
            },
            `SELECT countIf(${IS_COLD}) / count() * 100 AS pct
FROM traces
WHERE ${INVOCATION}`,
          ),
          "invocations-by-function": timeSeries(
            "Invocations by function",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ${FUNCTION} AS function, count() AS invocations
FROM traces
WHERE ${INVOCATION}
  AND ${topSeries(FUNCTION, "traces", INVOCATION)}
GROUP BY ts, function
ORDER BY ts`,
          ),
          "errors-by-function": timeSeries(
            "Failed invocations by function",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ${FUNCTION} AS function, count() AS errors
FROM traces
WHERE ${INVOCATION} AND StatusCode = 'Error'
  AND ${topSeries(FUNCTION, "traces", `${INVOCATION} AND StatusCode = 'Error'`)}
GROUP BY ts, function
ORDER BY ts`,
            "A failure here is the invocation itself: a handler that threw, or one the platform stopped.",
          ),
          "duration-percentiles": timeSeries(
            "Duration percentiles",
            { showLegend: true, unit: "ms" },
            `SELECT ts, q.1 AS series, q.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         round(quantile(0.50)(Duration) / 1000000, 1) AS p50,
         round(quantile(0.95)(Duration) / 1000000, 1) AS p95,
         round(quantile(0.99)(Duration) / 1000000, 1) AS p99
  FROM traces
  WHERE ${INVOCATION}
  GROUP BY ts
)
ARRAY JOIN [('P50', p50), ('P95', p95), ('P99', p99)] AS q
ORDER BY ts`,
            "The reference charts the average and the maximum. The average hides the tail that bills, and the maximum is one bad invocation.",
          ),
          "duration-by-function": timeSeries(
            "P95 duration by function",
            { showLegend: true, unit: "ms" },
            `SELECT ${SERIES_BUCKET()} AS ts,
       ${FUNCTION} AS function,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms
FROM traces
WHERE ${INVOCATION}
  AND ${topSeries(FUNCTION, "traces", INVOCATION)}
GROUP BY ts, function
ORDER BY ts`,
          ),
          "cold-vs-warm": timeSeries(
            "Cold and warm invocations",
            { showLegend: true, stacked: true },
            `SELECT ts, counted.1 AS series, counted.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         countIf(${IS_COLD}) AS cold,
         countIf(NOT ${IS_COLD}) AS warm
  FROM traces
  WHERE ${INVOCATION}
  GROUP BY ts
)
ARRAY JOIN [('Cold', cold), ('Warm', warm)] AS counted
ORDER BY ts`,
            "Cold starts cluster after a deploy and after idle. A steady trickle means the function never stays warm.",
          ),
          "cold-start-penalty": timeSeries(
            "P95 duration, cold against warm",
            { showLegend: true, unit: "ms" },
            `SELECT ts, q.1 AS series, q.2 AS value
FROM (
  SELECT ${SERIES_BUCKET()} AS ts,
         round(quantileIf(0.95)(Duration, ${IS_COLD}) / 1000000, 1) AS cold,
         round(quantileIf(0.95)(Duration, NOT ${IS_COLD}) / 1000000, 1) AS warm
  FROM traces
  WHERE ${INVOCATION}
  GROUP BY ts
)
ARRAY JOIN [('Cold', cold), ('Warm', warm)] AS q
ORDER BY ts`,
            "The gap is what initialization costs. A platform's own metrics cannot ask this: they carry no per-invocation cold-start flag.",
          ),
          "by-trigger": timeSeries(
            "Invocations by trigger",
            { showLegend: true, stacked: true },
            `SELECT ${SERIES_BUCKET()} AS ts, ${TRIGGER} AS trigger, count() AS invocations
FROM traces
WHERE ${INVOCATION}
  AND ${topSeries(TRIGGER, "traces", INVOCATION)}
GROUP BY ts, trigger
ORDER BY ts`,
            "Semconv names five: http, pubsub, datasource, timer, other. It is an open enum, so the cap stands.",
          ),
          functions: table(
            "Functions",
            `SELECT ${FUNCTION} AS function,
       count() AS invocations,
       round(quantile(0.50)(Duration) / 1000000, 1) AS p50_ms,
       round(quantile(0.95)(Duration) / 1000000, 1) AS p95_ms,
       round(countIf(StatusCode = 'Error') / count() * 100, 2) AS error_pct,
       round(countIf(${IS_COLD}) / count() * 100, 1) AS cold_pct
FROM traces
WHERE ${INVOCATION}
GROUP BY function
ORDER BY invocations DESC
LIMIT 40`,
          ),
          "recent-failures": table(
            "Recent failed invocations",
            `SELECT Timestamp AS ts,
       ${FUNCTION} AS function,
       ${TRIGGER} AS trigger,
       SpanAttributes['faas.invocation_id'] AS invocation_id,
       round(Duration / 1000000, 1) AS duration_ms,
       StatusMessage AS status
FROM traces
WHERE ${INVOCATION} AND StatusCode = 'Error'
ORDER BY ts DESC
LIMIT 50`,
            "The invocation id is the platform's own request id, so a row here can be looked up in the function's logs.",
          ),
        },
        layouts: layout([
          split(
            5,
            "invocations",
            "error-rate",
            "p95-duration",
            "cold-start-rate",
          ),
          split(9, "invocations-by-function", "errors-by-function"),
          split(9, "duration-percentiles", "duration-by-function"),
          split(9, "cold-vs-warm", "cold-start-penalty"),
          split(9, "by-trigger", "functions"),
          split(9, "recent-failures"),
        ]),
      },
    },
  },
];
