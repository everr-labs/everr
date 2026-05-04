---
name: local-debugging
description: Use when debugging local OpenTelemetry-instrumented services with Everr traces, logs, metrics, slow requests, runtime errors, or instrumentation verification.
---

# Local Debugging With Everr

Use Everr telemetry to debug local OpenTelemetry apps: runtime errors, slow requests, regressions, and whether instrumentation emits data. Data only exists while `everr telemetry start` or Everr Desktop is running.

Query command:
- `everr telemetry query "<SQL>"`: run read-only SQL against local telemetry.
- Allowed statements: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`.
- Always include a time window and a `LIMIT`.
- Responses are capped at 16 MiB.

Schema:
- Start with `otel_traces` and `otel_logs`.
- `otel_traces` key columns: `Timestamp`, `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`.
- `otel_logs` key columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`, `ResourceAttributes`.
- Metrics tables exist for sums, gauges, histograms, exponential histograms, and summaries. Discover exact columns only when needed:
  - `everr telemetry query "SHOW TABLES"`
  - `everr telemetry query "DESCRIBE TABLE otel_traces"`

Investigation playbook:
- Check freshness first: `everr telemetry query "SELECT max(Timestamp) AS last_seen FROM otel_traces"`
- Start broad, then narrow by `ServiceName`, a recent `Timestamp` window, `SpanName`, `SeverityNumber`, or attributes.
- Use traces for flow and latency; use logs for discrete facts and errors.
- Pivot logs to traces with `TraceId`.
- For wrapped commands, query `ServiceName = 'everr-wrap-<cmd>'`.
- Empty or stale results usually mean the app is not running, not exporting OTLP to the URL from `everr telemetry endpoint`, or the collector is not up.

Useful queries:
- Recent spans: `everr telemetry query "SELECT Timestamp, ServiceName, SpanName, Duration, StatusCode FROM otel_traces WHERE Timestamp > now() - INTERVAL 15 MINUTE ORDER BY Timestamp DESC LIMIT 50"`
- Slowest spans: `everr telemetry query "SELECT SpanName, quantile(0.95)(Duration) AS p95, count() AS n FROM otel_traces WHERE ServiceName = '<service>' AND Timestamp > now() - INTERVAL 15 MINUTE GROUP BY SpanName ORDER BY p95 DESC LIMIT 20"`
- Recent errors: `everr telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 100"`
- One trace: `everr telemetry query "SELECT Timestamp, SpanName, Duration, StatusCode, StatusMessage FROM otel_traces WHERE TraceId = '<trace-id>' ORDER BY Timestamp ASC"`
