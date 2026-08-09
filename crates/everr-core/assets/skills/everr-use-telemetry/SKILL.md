---
name: everr-use-telemetry
description: Use when investigating production or local behavior with logs, traces, metrics, errors, crashes, slow requests, flaky tests, regressions, missing behavior, stale telemetry, user reports, incidents, or questions that real runtime data can answer.
---

## Startup Access

Before using the everr CLI, request for the smallest sandbox access that lets Everr commands work:

- Filesystem read: `~/Library/Application Support/everr/session.json`, `~/Library/Application Support/everr/session-dev.json`, and their parent directory.
- Local network: `127.0.0.1`, `localhost`, and the ports 54318, 54320, 54418, 54420.
- Production network: `https://app.everr.dev`

If the current tool cannot ask for a blanket permission grant, request scoped command approvals before the first Everr command instead of trying a sandboxed command that is expected to fail.

# Use Telemetry With Everr

Use Everr telemetry before guessing when real traces, logs, metrics, or captured command output can explain behavior. Always check whether telemetry can help before continuing with code-only debugging.

## Critical: Only Raw SQL

The ONLY query command is `everr cloud query "<SQL>"` or `everr local query "<SQL>"`. The only optional flag is `--format` (values: `table`, `json`, `ndjson`).

## Choose The Source

| Question | Use |
| --- | --- |
| Production, deployed services, customer reports, cloud CI history | `everr cloud query "<SQL>"` |
| Local app, dev server, local tests, wrapped command output | `everr local query "<SQL>"` |
| What alerts fired, why, and whether the notification went out | Read `rules/alert-history.md`, then `everr cloud query "<SQL>"` |
| Current CI run, branch status, failed jobs, workflow logs | Use the `everr-working-with-ci` skill |
| Missing or stale local telemetry | Use the `everr-setup-telemetry` skill |

If an Everr command fails, investigate why: collector stopped, stale app, wrong repo, missing auth, missing import, bad query, or CLI bug. **Follow the error message literally** — if it says run `everr local start`, run that. Do not invent alternative explanations for the error or silently replace real telemetry with guesses.

## Default Workflow

1. Check freshness before diagnosing: query the newest `Timestamp` in the relevant table.
2. State the question telemetry should answer.
3. Pick cloud or local data based on where the behavior happened.
4. Discover what data exists: run `DESCRIBE TABLE <table>` or query a few recent rows to see available columns and attributes before assuming conventions.
5. Start broad, then narrow by service, time range, severity, trace id, span name, run id, branch, route, endpoint, or attributes.
6. Use traces for flow and latency; use logs for errors and discrete facts; use metrics for rates and resource changes.
7. Pivot between logs and traces with `TraceId`.
8. If the data is empty, stale, or missing the needed field, treat instrumentation as the next problem to solve.
9. Explain what the data shows and what remains unknown.

## Query Rules

- **Always include a time window and LIMIT** for diagnostic queries. Cloud enforces a 1000-row hard limit and 30s timeout — queries without time windows will hit these limits. Local queries without windows are wasteful.
- Freshness checks and schema discovery (`DESCRIBE`, `SHOW TABLES`) may omit the time window.
- Use read-only SQL only: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`.

## Tables And Columns

SQL starts with the same query-facing table names for local and cloud:

- `traces`
- `logs`
- `metrics_gauge`
- `metrics_sum`
- `metrics_histogram`
- `metrics_exponential_histogram`
- `metrics_summary`

Cloud has one more table, `alert_events`, holding alert history:
evaluations, state transitions, withheld notifications, and delivery
attempts. Read `rules/alert-history.md` before querying it, and never guess
its columns from this section. It is cloud only, because alerting does not
run locally.

Useful trace columns: `Timestamp`, `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`.

Useful log columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`, `ResourceAttributes`.

`Duration` is nanoseconds (`UInt64`): divide by `1e9` for seconds, `1e6` for milliseconds.

`SpanAttributes`, `LogAttributes`, and `ResourceAttributes` are key/value maps; read a key with `Column['key']`. **Before assuming attribute names** (like `SpanAttributes['http.route']` or `SpanAttributes['db.statement']`), discover what exists with `DESCRIBE TABLE <table>` or by sampling a few rows. OTel attribute naming conventions vary across languages and frameworks.

## Useful Queries

Check freshness:
```sql
SELECT max(Timestamp) FROM traces
```

Discover what spans exist:
```sql
SELECT SpanName, ServiceName, count() AS c
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR
GROUP BY SpanName, ServiceName
ORDER BY c DESC
LIMIT 20
```

Recent errors:
```sql
SELECT Timestamp, ServiceName, SeverityText, Body, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 1 HOUR
  AND SeverityNumber >= 17
ORDER BY Timestamp DESC
LIMIT 50
```

Slow spans:
```sql
SELECT Timestamp, ServiceName, SpanName, Duration, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 30 MINUTE
ORDER BY Duration DESC
LIMIT 20
```

Full trace:
```sql
SELECT Timestamp, ServiceName, SpanName, Duration, StatusCode, StatusMessage
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR
  AND TraceId = '<trace-id>'
ORDER BY Timestamp ASC
LIMIT 200
```

Correlated logs for a trace:
```sql
SELECT Timestamp, SeverityText, Body
FROM logs
WHERE Timestamp > now() - INTERVAL 1 HOUR
  AND TraceId = '<trace-id>'
ORDER BY Timestamp ASC
LIMIT 200
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

## Group Errors By Fingerprint

Everr groups error logs into Errors by a *fingerprint*: the `error.fingerprint` log attribute when present, else a hash of the service, exception type, and a normalized exception message. The fingerprint is a ClickHouse UDF, `errorFingerprint(ServiceName, LogAttributes)`, available on both cloud and local telemetry, so you get the same identity the app groups by. The "Copy agent prompt" button in the web UI hands you a Fingerprint.

An error log has a `service.name` resource attribute, `SeverityNumber >= 17`, and an exception type or message:
```sql
mapContains(ResourceAttributes, 'service.name')
AND SeverityNumber >= 17
AND (
  mapContains(LogAttributes, 'exception.type')
  OR mapContains(LogAttributes, 'exception.message')
)
```

Occurrences of one Fingerprint (widen the window if the Error is older):
```sql
SELECT toString(Timestamp) AS timestamp, ServiceName, TraceId,
  LogAttributes['exception.stacktrace'] AS stacktrace
FROM logs
WHERE Timestamp > now() - INTERVAL 7 DAY
  AND mapContains(ResourceAttributes, 'service.name')
  AND SeverityNumber >= 17
  AND errorFingerprint(ServiceName, LogAttributes) = '<fingerprint>'
ORDER BY Timestamp DESC
LIMIT 50
```

## Error Troubleshooting

| Error | Action |
| --- | --- |
| `telemetry collector isn't running` | Run `everr local start` or open Everr Desktop |
| `can't reach the telemetry collector because local network access is blocked` | Allow local network access for the tool or run the command outside the sandbox |
| `telemetry collector is busy` | Wait a moment and retry |
| `no active session` | Run `everr cloud login` |
| `Session expired` | Run `everr cloud login` |

When a local query fails, always run `everr local status` to diagnose the collector state before trying workarounds.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Inventing subcommands or flags (`query traces`, `--filter`, `--window`) | Only `everr cloud query "<SQL>"` or `everr local query "<SQL>"` with optional `--format`. Everything else is in the SQL. |
| Writing queries without a time window | Always add `WHERE Timestamp > now() - INTERVAL N HOUR/MINUTE`. |
| Writing cloud queries without LIMIT | Cloud enforces 1000-row limit. Always include `LIMIT`. |
| Assuming attribute names without discovering them | Run `DESCRIBE TABLE` or sample rows first. Conventions vary. |
| Getting "collector isn't running" but not running `everr local start` | Follow the error message literally. |
| Diagnosing without checking freshness | Query `max(Timestamp)` first. If data is hours old, it's stale. |

## Integrated Examples

For "production users are seeing errors":
1. Query cloud logs for recent errors with a time window.
2. Pick a representative `TraceId` and query cloud traces for the full request.
3. Compare errors by service, route, version, or deploy-related attributes if available.
4. Explain whether the data points to one service, one path, one release, or a broad outage.

For "my local request is slow":
1. Run `everr local status`. If stopped, run `everr local start`.
2. Check freshness: `SELECT max(Timestamp) FROM traces`.
3. Query recent slow spans from `traces`.
4. Pick the slowest `TraceId` and query the full trace in timestamp order.
5. If spans are missing around the slow boundary, use `everr-setup-telemetry` to add the next targeted signal.

For "debug this failing local test":
1. Check whether the test or app emits logs, traces, metrics, or wrapped command output.
2. If yes, rerun the test and query fresh local logs or traces with a filter for the test name or run id.
3. If no useful telemetry exists, add targeted debug telemetry or explain why telemetry cannot help and debug with the test output and code path.
