---
name: everr-setup-telemetry
description: Use when a task mentions adding or fixing telemetry, OpenTelemetry, OTLP exporters, local collector setup, production-like local signals, debug telemetry, service.name, missing or stale spans/logs/metrics, or instrumentation verification.
---

# Setup Telemetry With Everr

Use this skill when an app, service, test, script, or command needs to emit telemetry into Everr. Local telemetry lets development match production behavior closely, and debug telemetry lets the agent collect extra evidence without guessing.

Prefer real OpenTelemetry for runtime services. Use `everr wrap` only for bounded build, lint, or one-off commands that do not emit OpenTelemetry.

## Default Workflow

1. Run `everr local status`.
2. If the collector is stopped, run `everr local start` or ask the user to open Everr Desktop.
3. Run `everr local endpoint` and use that OTLP/HTTP URL in exporters.
4. Inspect the app before adding packages: framework, runtime, existing OTel setup, startup path, logger, and test runner.
5. Add the smallest standard OTel setup for the stack: `service.name`, traces, logs, useful resource attributes, automatic error capture, and an OTLP/HTTP exporter.
6. Gate local-only exporters so local collector URLs do not ship in production bundles.
7. Trigger the instrumented path and verify fresh rows with `everr local query`.
8. Do not claim setup works until Everr shows new telemetry.

## Command Choice

| Need | Command |
| --- | --- |
| Check collector state | `everr local status` |
| Start the CLI collector | `everr local start` |
| Get the OTLP/HTTP endpoint | `everr local endpoint` |
| Verify telemetry arrived | `everr local query "<SQL>"` |
| Capture build/lint output | `everr wrap -- <command>` |

`everr local query` accepts ClickHouse-style SQL against the local telemetry store.

## Runtime Instrumentation

OpenTelemetry clients can export directly to the local collector. No wrapper is needed for instrumented apps.

When OpenTelemetry is missing:
- Add the SDK, OTLP/HTTP exporter, and a clear `service.name`.
- Load instrumentation before importing HTTP, database, queue, or framework modules.
- Add spans around entry points and I/O boundaries when auto-instrumentation is not enough.
- Capture errors as structured telemetry, not only terminal output.
- Redact secrets, tokens, emails, and request bodies before export.

Do not make high-volume runtime traces or debug logs print to stdout/stderr just so they can be inspected. Export them to Everr and query them.

## Debug Telemetry

Use debug telemetry when normal telemetry does not explain local behavior yet.

- Emit it at debug level or behind a development flag.
- Include concrete attributes: route, command, job id, test name, feature, user-safe identifiers, branch, commit, and correlation ids when available.
- Prefer one useful log or span at each boundary over many noisy messages inside loops.
- Remove or gate anything that should not be present in production.

Do not optimize local debug telemetry for storage cost. Rich local evidence is usually cheaper than another round of guessing.

## JavaScript Defaults

For Node.js services:
- Prefer `@opentelemetry/auto-instrumentations-node` with `@opentelemetry/sdk-node`.
- For ESM apps, load instrumentation with `node --import ./instrumentation.mjs app.js` or the project startup hook.
- For CommonJS or zero-code setup, `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"` is acceptable.
- If configuring endpoints in code, send traces to `<endpoint>/v1/traces`, logs to `<endpoint>/v1/logs`, and metrics to `<endpoint>/v1/metrics`.
- Record `uncaughtException` and `unhandledRejection`, flush telemetry, then preserve the original crash behavior.

For browser apps:
- Keep local exporters dev/test gated.
- Use OTLP HTTP exporters only; browser gRPC export is not supported.
- Capture document load, user interaction, XHR, fetch, `window.error`, and `window.unhandledrejection` when relevant.
- Check browser devtools for CORS or CSP errors when telemetry does not arrive.

## Build, Lint, And Test Commands

Use `everr wrap -- <command>` only when the command is not OpenTelemetry-instrumented and the task needs its output in local telemetry.

- The wrapped command runs only when the local collector is available.
- stdout and stderr lines are mirrored into `otel_logs`.
- The service name is `everr-wrap-<cmd>`.
- The wrapped command keeps its original exit code.

For Playwright or other E2E tests, capture both the app under test and the test runner's view of browser failures. Add a run id such as `e2e.run_id=<uuid>` to resource attributes, emit page errors, console errors, and request failures as OTel logs, then query by that run id.

## Production Export

When setting up production telemetry, use Everr's OTLP HTTP ingest endpoint and an organization ingest key from the user's secret manager. Do not invent credentials or hardcode keys. Keep production telemetry lower-noise than local debug telemetry, and keep secrets out of attributes and log bodies.

## Verification Queries

Fresh trace check:

```sql
SELECT Timestamp, ServiceName, SpanName, TraceId
FROM otel_traces
ORDER BY Timestamp DESC
LIMIT 20
```

Fresh log check:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, TraceId
FROM otel_logs
ORDER BY Timestamp DESC
LIMIT 20
```

Run-id check:

```sql
SELECT Timestamp, ServiceName, Body
FROM otel_logs
WHERE ResourceAttributes['e2e.run_id'] = '<run-id>'
ORDER BY Timestamp DESC
LIMIT 20
```
