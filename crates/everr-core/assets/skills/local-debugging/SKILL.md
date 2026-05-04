---
name: local-debugging
description: Use whenever a task asks to debug, diagnose, investigate, reproduce, or explain a local problem, bug, error, failure, slow behavior, flaky behavior, regression, missing signal, or runtime issue. Always check whether Everr/OpenTelemetry traces, logs, metrics, or wrapped command output can help before continuing with code-only debugging.
---

# Local Debugging With Everr

Use Everr telemetry from the repository root to debug local problems when traces, logs, metrics, or wrapped command output can explain behavior.

## Activation Signals

Use this skill for debugging requests such as:
- runtime errors, exceptions, crashes, failed local commands, failing tests, slow requests, flaky behavior, regressions, missing spans, stale telemetry, or instrumentation checks
- prompts containing "debug", "diagnose", "investigate", "reproduce", "why is this failing", "why is this slow", or "what happened"

## Performance Rule

Do not make runtime traces or high-volume debug logs visible on stdout/stderr just so they can be inspected. For performance and noise control, prefer exporting traces/logs/metrics to the local collector and query them with `everr telemetry query`. Use stdout/stderr capture only for bounded build or lint commands via `everr wrap`.

## Default Workflow

1. First decide whether local OpenTelemetry data could help. Use telemetry when the problem may involve runtime behavior, local services, requests, jobs, tests, command output, logs, traces, metrics, latency, or errors.
2. If telemetry could help, run `everr telemetry status` when the collector state is unknown.
3. Check freshness before diagnosing behavior: query the newest `Timestamp`.
4. Start broad, then narrow by `ServiceName`, recent `Timestamp`, `SpanName`, `SeverityNumber`, `TraceId`, or attributes.
5. Use traces for request flow and latency; use logs for errors and discrete facts.
6. Pivot between logs and traces with `TraceId`.
7. If data is empty or stale, treat setup as the bug: verify the app is running, exporters point at `everr telemetry endpoint`, and the collector is up.
8. If telemetry cannot help, say why briefly, then continue with the best code, test, or configuration debugging path.

## Command Choice

| Need | Command |
| --- | --- |
| Collector state | `everr telemetry status` |
| OTLP/HTTP endpoint | `everr telemetry endpoint` |
| Run a read-only query | `everr telemetry query "<SQL>"` |
| Discover tables | `everr telemetry query "SHOW TABLES"` |
| Inspect trace columns | `everr telemetry query "DESCRIBE TABLE otel_traces"` |
| Inspect log columns | `everr telemetry query "DESCRIBE TABLE otel_logs"` |

Query rules:
- Allowed statements: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`.
- Include a recent time window and `LIMIT` for diagnostic queries.
- Freshness checks and schema discovery may omit the time window.
- Responses are capped at 16 MiB.

Core schema:
- Start with `otel_traces` and `otel_logs`.
- `otel_traces` key columns: `Timestamp`, `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`.
- `otel_logs` key columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`, `ResourceAttributes`.
- Metrics tables exist for sums, gauges, histograms, exponential histograms, and summaries. Discover exact columns only when metrics are needed.

Useful queries:
- Freshness: `everr telemetry query "SELECT max(Timestamp) AS last_seen FROM otel_traces"`
- Recent spans: `everr telemetry query "SELECT Timestamp, ServiceName, SpanName, Duration, StatusCode FROM otel_traces WHERE Timestamp > now() - INTERVAL 15 MINUTE ORDER BY Timestamp DESC LIMIT 50"`
- Slowest spans: `everr telemetry query "SELECT SpanName, quantile(0.95)(Duration) AS p95, count() AS n FROM otel_traces WHERE ServiceName = '<service>' AND Timestamp > now() - INTERVAL 15 MINUTE GROUP BY SpanName ORDER BY p95 DESC LIMIT 20"`
- Recent errors: `everr telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 100"`
- One trace: `everr telemetry query "SELECT Timestamp, SpanName, Duration, StatusCode, StatusMessage FROM otel_traces WHERE TraceId = '<trace-id>' ORDER BY Timestamp ASC"`
- Wrapped command logs: `everr telemetry query "SELECT Timestamp, SeverityText, Body FROM otel_logs WHERE ServiceName = 'everr-wrap-<cmd>' AND Timestamp > now() - INTERVAL 15 MINUTE ORDER BY Timestamp DESC LIMIT 100"`

## Integrated Example

For "my local request is slow":
1. Run `everr telemetry status`; if stopped, start the collector or ask the user to open Everr Desktop.
2. Run the freshness query and confirm recent rows exist.
3. Find recent spans for the service, then run the slowest-spans query with its `ServiceName`.
4. Pick a slow span, copy its `TraceId`, and query the full trace in timestamp order.
5. Explain the slow operation, missing instrumentation, or stale-data setup issue before proposing a fix.

For "debug this failing local test":
1. Check whether the failure might emit logs, traces, metrics, or wrapped command output.
2. If yes, check `everr telemetry status`, run or rerun the test, then query recent logs or wrapped command logs. Do not add noisy stdout/stderr trace dumps.
3. If no useful telemetry is possible, state that and debug with the test output and code path instead.
