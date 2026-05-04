---
name: local-telemetry-setup
description: Use when setting up Everr local OpenTelemetry collection, adding missing OTel instrumentation, configuring OTLP exporters, or capturing build and lint logs.
---

# Local Telemetry Setup With Everr

Use this skill when a local app or command needs to emit telemetry into Everr before debugging.

Start by checking whether the collector is running:
- Run `everr telemetry status`.
- If it reports `collector: stopped`, run `everr telemetry start` or ask the user to open Everr Desktop.
- Use `everr telemetry endpoint` for the OTLP/HTTP exporter URL.

Setup paths:
- Standalone CLI: run `everr telemetry start` in one terminal, then query from another terminal.
- To confirm the current collector URL, run `everr telemetry endpoint`.
- Point OTLP/HTTP exporters at the URL from `everr telemetry endpoint`.
- OpenTelemetry clients can export telemetry directly to the local collector; no Everr wrapper is needed for instrumented runtime services.

When OpenTelemetry is missing:
- Inspect the app framework and dependencies before adding packages.
- Add the smallest standard OTel setup for that stack: SDK, resource/service name, auto-instrumentations when available, and an OTLP/HTTP exporter.
- Configure the exporter endpoint from `everr telemetry endpoint`.
- Trigger the instrumented path and verify rows with `everr telemetry query`.
- Do not claim setup works until Everr shows fresh telemetry.

Use `everr wrap` only for build and linting tasks that do not emit OpenTelemetry:
- Use `everr wrap -- <command>`.
- The wrapped command is only run when the local collector is available.
- stdout and stderr lines are mirrored into `otel_logs`.
- The service name is `everr-wrap-<cmd>`.
- A non-zero wrapped command exit code is preserved.
- Do not use `everr wrap` as the main solution for runtime app debugging, server requests, UI interactions, or traces. Add real OTel instrumentation instead.

When adding instrumentation:
- Set `service.name`.
- Add spans around entry points and I/O boundaries.
- Trigger the instrumented path, then verify rows with `everr telemetry query`.
- Do not claim instrumentation works unless the query returns the new signal.
