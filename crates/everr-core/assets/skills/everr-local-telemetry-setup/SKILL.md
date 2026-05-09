---
name: everr-local-telemetry-setup
description: Use when a task mentions setting up local telemetry, OTLP/HTTP exporters, missing OpenTelemetry instrumentation, service.name, telemetry verification
---

# Local Telemetry Setup With Everr

Use this skill when a local app or command needs to emit telemetry into Everr before debugging. Prefer real OpenTelemetry for runtime services; use `everr wrap` only for build and lint commands that do not emit OTel.

## Default Workflow

1. Run `everr local status` first.
2. If the collector is stopped, run `everr local start` or ask the user to open Everr Desktop.
3. Run `everr local endpoint` and use that OTLP/HTTP URL in exporters.
4. Check whether the app already has OpenTelemetry before adding packages.
5. Add the smallest standard OTel setup for the stack when instrumentation is missing, including automatic error capture for JavaScript runtimes.
6. Trigger the instrumented path and verify fresh rows with `everr local query`.
7. Do not claim setup works until Everr shows the new signal.

## Command Choice

| Need | Command |
| --- | --- |
| Check collector state | `everr local status` |
| Start the CLI collector | `everr local start` |
| Get the OTLP/HTTP endpoint | `everr local endpoint` |
| Verify telemetry arrived | `everr local query "<SQL>"` |
| Capture build or lint output | `everr wrap -- <command>` |

## Runtime App Setup

OpenTelemetry clients can export directly to the local collector. No Everr wrapper is needed for instrumented runtime services.

Do not configure runtime traces or high-volume debug logs to print to stdout/stderr for debugging. For performance and noise control, export traces/logs/metrics to the local collector and inspect them with `everr local query`.

When OpenTelemetry is missing:
- Inspect the app framework and dependencies first.
- Add the SDK, `service.name`, auto-instrumentations when available, automatic error capture, and an OTLP/HTTP exporter.
- Configure the exporter endpoint from `everr local endpoint`.
- Add spans around entry points and I/O boundaries when auto-instrumentation is not enough.
- Trigger the instrumented path, then verify rows with `everr local query`.

## JavaScript Auto-Instrumentation

Use auto-instrumentation first for JavaScript. Treat runtime error capture as part of that baseline setup: uncaught exceptions, unhandled rejections, and browser global errors should emit structured OTel logs by default. Then add manual spans or logs only where the automatic spans and error logs do not answer the debugging question.

For Node.js services:
- Prefer `@opentelemetry/auto-instrumentations-node` with `@opentelemetry/sdk-node`.
- Load instrumentation before the app imports HTTP, database, queue, or framework modules. For ESM apps, use `node --import ./instrumentation.mjs app.js` or the project's equivalent startup hook. For CommonJS or zero-code setup, `NODE_OPTIONS="--require @opentelemetry/auto-instrumentations-node/register"` is acceptable.
- Set `OTEL_SERVICE_NAME=<clear-local-service-name>` and `OTEL_EXPORTER_OTLP_ENDPOINT=<endpoint-from-everr-local-endpoint>` when using environment configuration.
- If configuring exporters in code, send traces to `<endpoint>/v1/traces`, logs to `<endpoint>/v1/logs`, and metrics to `<endpoint>/v1/metrics`.
- Disable noisy instrumentations, such as filesystem spans, when they bury the request or job signal.
- Include structured error logging for `uncaughtException` and `unhandledRejection`. Flush before preserving crash behavior; do not swallow fatal errors.

For browser apps:
- Browser OpenTelemetry is less mature than Node.js. Keep the setup dev/test gated and do not ship the local collector URL in production bundles.
- Use `@opentelemetry/sdk-trace-web`, an OTLP HTTP exporter, `BatchSpanProcessor`, `@opentelemetry/instrumentation`, and `registerInstrumentations`.
- Start with document load, user interaction, XHR, and fetch instrumentation when relevant to the app. Add `@opentelemetry/context-zone` when browser async context needs to propagate across callbacks.
- Include structured error logging for `window.error` and `window.unhandledrejection` in the same dev/test bootstrap.
- Use HTTP/protobuf or HTTP/JSON exporters only. Browser gRPC export is not supported.
- Check browser devtools for CORS or CSP errors when spans do not reach the collector.

## Dev Start Feedback Loop

Verify telemetry with the default dev start commands for the project. A setup is not done just because instrumentation was added or a custom startup command works.

Keep the feedback loop tight: start the app normally, trigger the relevant path, query fresh `otel_traces` or `otel_logs`, and adjust the setup until data arrives.

## JavaScript Errors

Collect errors as structured telemetry, not just terminal output.

For Node.js:
- For caught errors inside an active operation, call `span.recordException(error)`, set span status to error, and set `error.type` from `error.name` or the concrete error class.
- For existing loggers, prefer an OpenTelemetry log bridge/exporter or a small shared error logging helper that emits one structured OTel log with `exception.type`, `exception.message`, and `exception.stacktrace`.
- Add `process.on("uncaughtException")` and `process.on("unhandledRejection")` only to record and flush final telemetry before preserving the original crash behavior. Do not swallow fatal errors.
- Avoid double-reporting the same error as both a span exception and a log unless the task needs both views.

For browser apps:
- Register `window.addEventListener("error", ...)` and `window.addEventListener("unhandledrejection", ...)` in the dev/test telemetry bootstrap.
- For framework-level handlers, such as error boundaries, route the error into the same helper instead of creating a second format.
- Include useful attributes: route, URL, component or feature name if known, browser name when known, `exception.type`, `exception.message`, and stacktrace.
- Treat error messages and stacktraces as potentially sensitive. Redact tokens, passwords, emails, and request bodies before export.

## Playwright E2E Telemetry

When setting up telemetry for Playwright tests, capture both the app under test and the test runner's view of browser failures.

- Start or verify the local collector before the test run. Prefer a Playwright project dependency for setup over `globalSetup` when adding project-level setup because it appears in the HTML report and can use fixtures.
- Create one run id per test run and add it to `OTEL_RESOURCE_ATTRIBUTES`, for example `e2e.run_id=<uuid>,test.suite=playwright`.
- Start the app under test with the local OTLP endpoint, a clear e2e `service.name`, and JS auto-instrumentation if the app is Node.js.
- Add an automatic Playwright fixture that listens for `page.on("pageerror")`, `page.on("console")` where `msg.type() === "error"`, `page.on("requestfailed")`, and popup/new page events. Emit these as OTel logs from the test runner with test title, file, project, browser, URL, and run id.
- Flush or shut down the test-runner OTel SDK in teardown or a custom reporter.
- After the run, query by `service.name` and `e2e.run_id` in `otel_logs` and `otel_traces` to prove fresh telemetry arrived.
- Useful verification query: `everr local query "SELECT Timestamp, ServiceName, Body FROM otel_logs WHERE ResourceAttributes['e2e.run_id'] = '<run-id>' ORDER BY Timestamp DESC LIMIT 20"`.

## Build And Lint Setup

Use `everr wrap` only when the task is build or lint output capture and the command does not emit OpenTelemetry:
- Run `everr wrap -- <command>`.
- The wrapped command runs only when the local collector is available.
- stdout and stderr lines are mirrored into `otel_logs`.
- The service name is `everr-wrap-<cmd>`.
- The wrapped command keeps its original exit code.
- Do not use `everr wrap` as the main solution for runtime app debugging, server requests, UI interactions, or traces. Add real OTel instrumentation instead.

## Dev-Only Telemetry

- Use `debug` level for traces and logs that are only useful in development.
- If a signal is not appropriate for production, emit it at debug level rather than info/warn/error.
- Do not optimize for storage cost on dev-only signals. Favor rich, verbose information over trimming data — the local collector is cheap to fill.

## Browser Apps

- Browser code can export OTel logs and traces to the local collector at the OTLP/HTTP endpoint, the same as server runtimes.
- Gate the browser exporter so it does not ship in the production bundle (e.g. behind `import.meta.env.DEV` or `process.env.NODE_ENV !== "production"`). The local collector URL must not appear in production builds.

## Integrated Example

For "set up local telemetry for this app":
1. Run `everr local status`; if stopped, start the collector or ask the user to open Everr Desktop.
2. Run `everr local endpoint` and copy the OTLP/HTTP URL.
3. Inspect dependencies to see whether OTel is already installed.
4. If missing, add the smallest standard OTel SDK/exporter setup for the app stack and set `service.name`.
5. Trigger one local request or job, then query recent rows from `otel_traces` or `otel_logs`.
6. Use `everr wrap -- <build-or-lint-command>` only if the task is build/lint capture, not runtime telemetry.
