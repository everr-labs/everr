---
name: local-debugging
description: Use when a task mentions local debugging with Everr telemetry, OpenTelemetry traces/logs/metrics, slow local requests, runtime errors, missing spans, stale telemetry, instrumentation verification, TraceId pivots, or querying the local collector.
---

# Local Debugging With Everr

Use Everr telemetry from the repository root to debug local OpenTelemetry apps: runtime errors, slow requests, regressions, and whether instrumentation emits fresh data.

## Default Workflow

1. Run `everr telemetry status` if the collector state is unknown.
2. Check freshness before diagnosing behavior: query the newest `Timestamp`.
3. Start broad, then narrow by `ServiceName`, recent `Timestamp`, `SpanName`, `SeverityNumber`, `TraceId`, or attributes.
4. Use traces for request flow and latency; use logs for errors and discrete facts.
5. Pivot between logs and traces with `TraceId`.
6. If data is empty or stale, treat setup as the bug: verify the app is running, exporters point at `everr telemetry endpoint`, and the collector is up.

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
