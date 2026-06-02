---
name: everr-setup-telemetry
description: Use when a task mentions adding or fixing telemetry, OpenTelemetry, local collector setup, debug telemetry, missing or stale spans/logs/metrics, or instrumentation verification.
---

# Setup Telemetry With Everr

Use this skill when an app, service, test, script, or command needs to emit telemetry into Everr. 

Local telemetry lets development match production behavior closely, and debug telemetry lets the agent collect extra evidence locally without guessing from the code.

## Rule Loading

Always read the relevant rule files before editing instrumentation. Use the table below to load the minimum guidance for the code path being changed.

| Use case / rule | Description |
| --- | --- |
| `resolve-values` | Resolve configuration values from the codebase before hardcoding or asking |
| `resources` | Resource attributes: service identity, version, environment, instance |
| `spans` | Spans: naming, kind, status, attributes, and hygiene |
| `logs` | Logs: structured logging, severity, trace correlation, delivery |
| `metrics` | Metrics: instrument types, naming, units, and cardinality |
| `error-tracking` | Error tracking: exceptions, release context, crash capture |
| `sensitive-data` | PII prevention, sanitization, hashing, redaction |
| `validation` | Telemetry validation locally and after deployment |
| `nodejs` | Node.js instrumentation setup and runtime pitfalls |
| `nextjs` | Next.js App Router, server/client split, trace propagation |
| `rust` | Rust tracing-based OpenTelemetry setup and runtime pitfalls |

For most runtime work, read `resolve-values`, `resources`, `error-tracking`, `sensitive-data`, `validation`, and the signal/runtime rules that match the task.

## Default Workflow

1. Run `everr local status`.
2. If the collector is stopped, run `everr local start` or ask the user to open Everr Desktop.
3. Use the `otlp:` URL from `everr local status` in local exporters. Do not guess or mention a default localhost port unless status returned it.
4. Inspect the app before adding packages: framework, runtime, existing OTel setup, startup path, logger, test runner, deployment manifests, and existing environment variables.
5. Resolve `service.name`, `service.version`, `deployment.environment.name`, OTLP endpoint, and auth configuration using `rules/resolve-values.md`.
6. Add the smallest standard OTel setup for the stack: stable service identity, useful resource attributes, traces, logs, metrics when supported, automatic error capture, safe redaction, and an OTLP/HTTP exporter.
7. Configure endpoint selection for both environments: local development exports to the `otlp:` URL from `everr local status`; production exports to `https://ingest.everr.dev/` with an ingest key from the secret manager.
8. Gate local-only exporters so local collector URLs do not ship in production bundles, and gate hosted ingest so it only runs when a production ingest key is present.
9. Trigger the instrumented path and verify fresh local rows with `everr local query`, filtered by the expected `ServiceName`, a recent time window, and a unique run, request, or test id when practical.
10. Do not claim setup works until query results prove the new telemetry came from the path just exercised.

## Command Choice

| Need | Command |
| --- | --- |
| Check collector state | `everr local status` |
| Start the CLI collector | `everr local start` |
| Get the OTLP/HTTP endpoint | `everr local status` |
| Verify telemetry arrived | `everr local query "<SQL>"` |
| Capture build/lint output | `everr wrap -- <command>` |

In plans and example commands, keep the endpoint as `<otlp-url-from-status>` until you have actual status output.

`everr local query` accepts ClickHouse-style SQL against the local telemetry store.

## Runtime Instrumentation

OpenTelemetry clients can export directly to the local collector. No wrapper is needed for instrumented apps.

When OpenTelemetry is missing:

- Add the SDK, OTLP/HTTP exporter, and a clear `service.name`.
- Check for official or community auto-instrumentation that matches the runtime and libraries before writing custom instrumentation.
- Load instrumentation before importing HTTP, database, queue, or framework modules.
- Add spans around entry points and I/O boundaries when auto-instrumentation is not enough.
- Capture errors as structured telemetry, not only terminal output.
- Redact secrets, tokens, emails, request bodies, auth headers, cookies, and raw customer payloads before export.
- Prefer instrumenting the app's existing structured logger or adding targeted OTel logs at important boundaries. Do not monkey-patch `console.*` or mirror all console output into telemetry unless it is temporary, development-gated, redacted, and bounded to the specific path being verified.

Do not make high-volume runtime traces or debug logs print to stdout/stderr just so they can be inspected. Export them to Everr and query them.

## Debug Telemetry

Use debug telemetry when normal telemetry does not explain local behavior yet.

- Emit it at debug level or behind a development flag.
- Include concrete attributes: route, command, job id, test name, feature, user-safe identifiers, branch, commit, and correlation ids when available.
- Prefer one useful log or span at each boundary over many noisy messages inside loops.
- Remove or gate anything that should not be present in production.

Do not optimize local debug telemetry for storage cost. Rich local evidence is usually cheaper than another round of guessing.

## Build, Lint, And Test Commands

Use `everr wrap -- <command>` only when the command is not OpenTelemetry-instrumented and the task needs its output in local telemetry.

- The wrapped command runs only when the local collector is available.
- stdout and stderr lines are mirrored into `otel_logs`.
- The service name is `everr-wrap-<cmd>`.
- The wrapped command keeps its original exit code.

For Playwright or other E2E tests, capture both the app under test and the test runner's view of browser failures. Add a run id such as `e2e.run_id=<uuid>` to resource attributes, emit page errors, console errors, and request failures as OTel logs, then query by that run id.

## Production Export

When setting up production telemetry, wire the app to Everr's hosted OTLP HTTP ingest endpoint and require an organization ingest key from the user's secret manager.

Use these production defaults:

- Endpoint: `https://ingest.everr.dev/`
- Header: `Authorization: Bearer <ingest-key>`
- Secret environment variable: `EVERR_INGEST_KEY`
- Service identity: a stable `service.name` hardcoded in the setup module for each service

If no production ingest key exists yet, tell the user to create one in the Everr dashboard from the user menu's **Ingest Keys** page, then store it in the deployment secret manager. Do not invent credentials, print keys, hardcode keys, or commit keys.

Implementation expectations:

- Use the local collector endpoint for development and test runs.
- Use hosted ingest only when `EVERR_INGEST_KEY` is set.
- Keep production telemetry lower-noise than local debug telemetry.
- Keep secrets, tokens, emails, request bodies, and raw customer payloads out of attributes and log bodies.
- Do not expose `EVERR_INGEST_KEY` in browser bundles. Browser production telemetry should go through a backend or collector that can attach the ingest key server-side.
- Preserve normal crash and shutdown behavior while flushing telemetry.

## Validation

Do not claim telemetry works until you have exercised the instrumented path and queried fresh telemetry that proves it.

See `rules/validation.md` for the full validation checklist.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Naming a likely collector URL such as a default localhost port before reading status | Use `<otlp-url-from-status>` in plans and examples until `everr local status` returns the actual endpoint. |
| Adding a run, request, or test marker but querying only by service and time | Filter the query by the marker too, or do not claim the marker proved freshness. |
| Mirroring every `console.*` call into logs | Prefer targeted OTel logs or the app's structured logger; any bridge must be temporary, gated, redacted, and bounded. |
| Verifying by UI visibility or absence of exporter errors | Run `everr local query` and show rows from the exercised path. |
| Exposing `EVERR_INGEST_KEY` to the browser | Route browser telemetry through a backend or collector that attaches credentials server-side. |
