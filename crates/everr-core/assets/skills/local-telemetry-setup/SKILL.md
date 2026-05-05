---
name: local-telemetry-setup
description: Use when a task mentions setting up Everr local telemetry, collector status, OTLP/HTTP exporters, missing OpenTelemetry instrumentation, service.name, local collector endpoints, telemetry verification, or wrapping build and lint commands.
---

# Local Telemetry Setup With Everr

Use this skill when a local app or command needs to emit telemetry into Everr before debugging. Prefer real OpenTelemetry for runtime services; use `everr wrap` only for build and lint commands that do not emit OTel.

## Default Workflow

1. Run `everr telemetry status` first.
2. If the collector is stopped, run `everr telemetry start` or ask the user to open Everr Desktop.
3. Run `everr telemetry endpoint` and use that OTLP/HTTP URL in exporters.
4. Check whether the app already has OpenTelemetry before adding packages.
5. Add the smallest standard OTel setup for the stack when instrumentation is missing.
6. Trigger the instrumented path and verify fresh rows with `everr telemetry query`.
7. Do not claim setup works until Everr shows the new signal.

## Command Choice

| Need | Command |
| --- | --- |
| Check collector state | `everr telemetry status` |
| Start the CLI collector | `everr telemetry start` |
| Get the OTLP/HTTP endpoint | `everr telemetry endpoint` |
| Verify telemetry arrived | `everr telemetry query "<SQL>"` |
| Capture build or lint output | `everr wrap -- <command>` |

## Runtime App Setup

OpenTelemetry clients can export directly to the local collector. No Everr wrapper is needed for instrumented runtime services.

Do not configure runtime traces or high-volume debug logs to print to stdout/stderr for debugging. For performance and noise control, export traces/logs/metrics to the local collector and inspect them with `everr telemetry query`.

When OpenTelemetry is missing:
- Inspect the app framework and dependencies first.
- Add the SDK, `service.name`, auto-instrumentations when available, and an OTLP/HTTP exporter.
- Configure the exporter endpoint from `everr telemetry endpoint`.
- Add spans around entry points and I/O boundaries when auto-instrumentation is not enough.
- Trigger the instrumented path, then verify rows with `everr telemetry query`.

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
1. Run `everr telemetry status`; if stopped, start the collector or ask the user to open Everr Desktop.
2. Run `everr telemetry endpoint` and copy the OTLP/HTTP URL.
3. Inspect dependencies to see whether OTel is already installed.
4. If missing, add the smallest standard OTel SDK/exporter setup for the app stack and set `service.name`.
5. Trigger one local request or job, then query recent rows from `otel_traces` or `otel_logs`.
6. Use `everr wrap -- <build-or-lint-command>` only if the task is build/lint capture, not runtime telemetry.
