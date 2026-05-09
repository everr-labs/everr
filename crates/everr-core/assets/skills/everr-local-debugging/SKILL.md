---
name: everr-local-debugging
description: Use this skill for debugging requests such as runtime errors, exceptions, crashes, failed local commands, failing tests, slow requests, flaky behavior, regressions, missing spans, stale telemetry, or instrumentation checks.
---

# Local Debugging With Everr

Use Everr telemetry from the repository root to debug local problems when traces, logs, metrics, or wrapped command output can explain behavior.

Always check whether Everr/OpenTelemetry traces, logs, metrics, or wrapped command output can help before continuing with code-only debugging.

## Performance Rule

Do not make runtime traces or high-volume debug logs visible on stdout/stderr just so they can be inspected. For performance and noise control, prefer exporting traces/logs/metrics to the local collector and query them with `everr local query`. Use stdout/stderr capture only for bounded build or lint commands via `everr wrap`.

## Default Workflow

1. First decide whether local OpenTelemetry data could help. Use telemetry when the problem may involve runtime behavior, local services, requests, jobs, tests, command output, logs, traces, metrics, latency, or errors.
2. Check freshness before diagnosing behavior: query the newest `Timestamp`.
3. Start broad, then narrow by `ServiceName`, recent `Timestamp`, `SpanName`, `SeverityNumber`, `TraceId`, or attributes.
4. Use traces for request flow and latency; use logs for errors and discrete facts.
5. Pivot between logs and traces with `TraceId`.
6. Fill missing information with more targeted OTel traces or logs before guessing. Ask for or collect the next specific signal needed to explain the failure. When instrumentation is absent or insufficient, invoke the `everr-local-telemetry-setup` skill to add it before continuing.
7. If data is empty or stale, treat setup as the bug: verify the app is running, exporters point at `everr local endpoint`, and the collector is up. Invoke the `everr-local-telemetry-setup` skill to fix collector, exporter, or `service.name` configuration.
8. If telemetry cannot help, say why briefly, then continue with the best code, test, or configuration debugging path.

If the collector is down, ask the user to start it with `everr local start` or by opening the Everr desktop app.

## Command Choice

| Need | Command |
| --- | --- |
| Collector state | `everr local status` |
| OTLP/HTTP endpoint | `everr local endpoint` |
| Run a read-only query | `everr local query "<SQL>"` |
| Inspect trace columns | `everr local query "DESCRIBE TABLE otel_traces"` |
| Inspect log columns | `everr local query "DESCRIBE TABLE otel_logs"` |

Query rules:
- Allowed statements: `SELECT`, `WITH`, `EXPLAIN`, `DESCRIBE`, `DESC`, `SHOW`.
- Include a recent time window and `LIMIT` for diagnostic queries.
- Freshness checks and schema discovery may omit the time window.
- Responses are capped at 16 MiB.


We use the official clickhouse-exporter schema from otel-contrib:
- Start with `otel_traces` and `otel_logs`.
- `otel_traces` key columns: `Timestamp`, `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`.
- `otel_logs` key columns: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`, `ResourceAttributes`.
- Metrics tables exist for sums, gauges, histograms, exponential histograms, and summaries. Discover exact columns only when metrics are needed.

## Integrated Example

For "my local request is slow":
1. Find recent spans for the service, then run the slowest-spans query with its `ServiceName`.
2. Pick a slow span, copy its `TraceId`, and query the full trace in timestamp order.
3. Explain the slow operation, missing instrumentation, or stale-data setup issue before proposing a fix.

For "debug this failing local e2e test":
1. Check whether the failure might emit logs, traces, metrics, or wrapped command output.
2. If yes, check `everr local status`, run or rerun the test, then query recent logs or wrapped command logs. Do not add noisy stdout/stderr trace dumps.
3. If no useful telemetry is possible, state that and debug with the test output and code path instead.
