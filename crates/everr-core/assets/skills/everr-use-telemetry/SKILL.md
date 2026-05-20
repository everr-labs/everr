---
name: everr-use-telemetry
description: Use when investigating production or local behavior with logs, traces, metrics, errors, crashes, slow requests, flaky tests, regressions, missing behavior, stale telemetry, user reports, incidents, or questions that real runtime data can answer.
---

# Use Telemetry With Everr

Use Everr telemetry before guessing when real traces, logs, metrics, or captured command output can explain behavior. Everr can query production telemetry in the cloud and local telemetry from the developer machine, so choose the data source that matches the question.

Always check whether telemetry can help before continuing with code-only debugging.

## Choose The Source

| Question | Use |
| --- | --- |
| Production, deployed services, customer reports, cloud CI history | `everr cloud query "<SQL>"` |
| Local app, dev server, local tests, wrapped command output | `everr local query "<SQL>"` |
| Current CI run, branch status, failed jobs, workflow logs | Use the `everr-working-with-ci` skill |
| Missing or stale local telemetry | Use the `everr-setup-telemetry` skill |

If an Everr command fails, investigate why: collector stopped, stale app, wrong repo, missing auth, missing import, bad query, or CLI bug. Do not silently replace real telemetry with guesses.

## Default Workflow

1. State the question telemetry should answer.
2. Pick cloud or local data based on where the behavior happened.
3. Check freshness before diagnosing: query the newest `Timestamp`.
4. Start broad, then narrow by service, time range, severity, trace id, span name, run id, branch, route, endpoint, or attributes.
5. Use traces for flow and latency; use logs for errors and discrete facts; use metrics for rates and resource changes.
6. Pivot between logs and traces with `TraceId`.
7. If the data is empty, stale, or missing the needed field, treat instrumentation as the next problem to solve.
8. Explain what the data shows and what remains unknown.

## Tables And Columns

Cloud SQL starts with:
- `traces`
- `logs`
- `metrics_gauge`
- `metrics_sum`

Local SQL starts with:
- `otel_traces`
- `otel_logs`
- metrics tables for sums, gauges, histograms, exponential histograms, and summaries

Useful trace columns: `Timestamp`, `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`.

Useful log columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`, `ResourceAttributes`.

Use `DESCRIBE TABLE <table>` when you need exact local metric columns.

## Query Rules

- Use read-only SQL only: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, or `SHOW`.
- Include a recent time window and `LIMIT` for diagnostic queries.
- Freshness checks and schema discovery may omit the time window.
- Keep limits under 1000 unless the user explicitly asks for more.
- Do not add tenant filters; Everr already enforces tenant isolation.
- Do not use `PREWHERE` unless the user explicitly asks.

## Useful Local Queries

Fresh traces:

```sql
SELECT Timestamp, ServiceName, SpanName, StatusCode, Duration, TraceId
FROM otel_traces
ORDER BY Timestamp DESC
LIMIT 20
```

Recent errors:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, TraceId
FROM otel_logs
WHERE SeverityNumber >= 17
ORDER BY Timestamp DESC
LIMIT 50
```

Full trace:

```sql
SELECT Timestamp, ServiceName, SpanName, Duration, StatusCode, StatusMessage
FROM otel_traces
WHERE TraceId = '<trace-id>'
ORDER BY Timestamp ASC
LIMIT 200
```

Slow spans:

```sql
SELECT Timestamp, ServiceName, SpanName, Duration, TraceId
FROM otel_traces
WHERE Timestamp > now() - INTERVAL 30 MINUTE
ORDER BY Duration DESC
LIMIT 20
```

## Useful Cloud Queries

Recent production errors:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 1 HOUR
  AND SeverityNumber >= 17
ORDER BY Timestamp DESC
LIMIT 50
```

Recent failed spans:

```sql
SELECT Timestamp, ServiceName, SpanName, StatusCode, StatusMessage, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR
  AND StatusCode = 'Error'
ORDER BY Timestamp DESC
LIMIT 50
```

Failure count by service:

```sql
SELECT ServiceName, count() AS errors
FROM logs
WHERE Timestamp > now() - INTERVAL 24 HOUR
  AND SeverityNumber >= 17
GROUP BY ServiceName
ORDER BY errors DESC
LIMIT 20
```

## Integrated Examples

For "production users are seeing errors":
1. Query cloud logs for recent errors.
2. Pick a representative `TraceId` and query cloud traces for the full request.
3. Compare errors by service, route, version, or deploy-related attributes if available.
4. Explain whether the data points to one service, one path, one release, or a broad outage.

For "my local request is slow":
1. Run `everr local status`.
2. Query recent slow spans from `otel_traces`.
3. Pick the slowest `TraceId` and query the full trace in timestamp order.
4. If spans are missing around the slow boundary, use `everr-setup-telemetry` to add the next targeted signal.

For "debug this failing local test":
1. Check whether the test or app emits logs, traces, metrics, or wrapped command output.
2. If yes, rerun the test and query fresh local logs or traces.
3. If no useful telemetry exists, add targeted debug telemetry or explain why telemetry cannot help and debug with the test output and code path.
