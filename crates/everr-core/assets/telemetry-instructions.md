Use Everr telemetry to debug local OpenTelemetry apps: runtime errors, slow
requests, regressions, and whether instrumentation emits data. Data only exists
while `everr telemetry start` or Everr Desktop is running.

Setup:
- Standalone CLI: run `everr telemetry start`, then query from another terminal.
- Everr Desktop: point OTLP/HTTP exporters at `http://127.0.0.1:54418`.

Commands:
- `everr telemetry query "<SQL>"`: run read-only SQL against local telemetry.
  Allowed statements: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`.
  Always include a time window and a `LIMIT`; responses are capped at 16 MiB.
- `everr telemetry endpoint`: print the current collector URL.
- `everr wrap -- <command>`: mirror stdout/stderr into `otel_logs` with
  `service.name = 'everr-wrap-<cmd>'`. Requires a running collector; without
  one, the command is not run. Non-zero wrapped exits pass through.
- `everr telemetry ai-instructions`: print this compact guide.

Schema:
- Start with `otel_traces` and `otel_logs`.
- `otel_traces` key columns: `Timestamp`, `TraceId`, `SpanId`,
  `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`,
  `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`,
  `ResourceAttributes`.
- `otel_logs` key columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`,
  `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`,
  `ResourceAttributes`.
- Metrics tables exist for sums, gauges, histograms, exponential histograms, and
  summaries. Discover exact columns only when needed:
  `everr telemetry query "SHOW TABLES"`
  `everr telemetry query "DESCRIBE TABLE otel_traces"`

Investigation playbook:
- Check freshness first:
  `everr telemetry query "SELECT max(Timestamp) AS last_seen FROM otel_traces"`
- Start broad, then narrow by `ServiceName`, a recent `Timestamp` window,
  `SpanName`, `SeverityNumber`, or attributes.
- Use traces for flow and latency; use logs for discrete facts and errors.
- Pivot logs to traces with `TraceId`.
- For commands that do not emit OTLP themselves, wrap them with
  `everr wrap -- <command>` and query `ServiceName = 'everr-wrap-<cmd>'`.
- Empty or stale results usually mean the app is not running, not configured to
  export OTLP to `http://127.0.0.1:54418`, or the collector is not up.

Useful queries:
- Recent spans:
  `everr telemetry query "SELECT Timestamp, ServiceName, SpanName, Duration, StatusCode FROM otel_traces WHERE Timestamp > now() - INTERVAL 15 MINUTE ORDER BY Timestamp DESC LIMIT 50"`
- Slowest spans:
  `everr telemetry query "SELECT SpanName, quantile(0.95)(Duration) AS p95, count() AS n FROM otel_traces WHERE ServiceName = '<service>' AND Timestamp > now() - INTERVAL 15 MINUTE GROUP BY SpanName ORDER BY p95 DESC LIMIT 20"`
- Recent errors:
  `everr telemetry query "SELECT Timestamp, ServiceName, SeverityText, Body FROM otel_logs WHERE SeverityNumber >= 17 AND Timestamp > now() - INTERVAL 1 HOUR ORDER BY Timestamp DESC LIMIT 100"`
- One trace:
  `everr telemetry query "SELECT Timestamp, SpanName, Duration, StatusCode, StatusMessage FROM otel_traces WHERE TraceId = '<trace-id>' ORDER BY Timestamp ASC"`

When adding instrumentation:
- Set `service.name`.
- Span entry points and I/O boundaries.
- After triggering the path, verify with a recent query. Do not claim the
  instrumentation works unless returned rows show the new signal.
