---
name: 009-error-tracking-approach
title: Decide the error tracking approach for the homepage
labels: [wayfinder:grilling]
status: closed
assignee: guido
blocked-by: [003-structured-errors-groundwork]
---

## Question

How do browser errors reach Everr: reuse or extend packages/auto-otel-errors, adopt the structured-errors shape, or something new? Decide the error log schema (grouping key, stack handling, source maps or not, unhandled rejections), and how this relates to the web-error-tracking worktree effort so the two do not fork.

## Resolution

1. **Capture: reuse `@everr/auto-otel-errors/browser` as-is.** The homepage initializes it exactly like the web app (global LoggerProvider, OTLP export, public browser ingest key; see packages/app/src/telemetry/client.ts). No new capture code and no evlog-style error codes for now; the `error.fingerprint` escape hatch the UDF already honors stays available if a specific error ever needs stable grouping.
2. **Capture scope: defaults plus router boundary.** `window.onerror` + `unhandledrejection` as shipped, plus `captureReactError` wired as the docs site router's default error component, mirroring the web app. `browserApiErrorsIntegration` (global patching) stays off.
3. **Grouping: the ClickHouse `errorFingerprint` UDF, unchanged.** Errors land in `otel_logs` and surface through the existing errors explore UI.
4. **Stacks: minified.** Source map symbolication is ruled out of scope for this whole map (moved to the map's Out of scope section as a separate future effort). Ticket 012 (profiling scope) inherits this constraint: profiler frames stay minified within this effort.
5. **Correlation: full envelope stamping.** The SDK's shared LogRecordProcessor stamps the ticket 008 envelope (session.id, url.path, viewport, ...) on every log record, errors included, so errors slice by page and session and link to heatmap and replay data with zero changes to auto-otel-errors.
6. **web-error-tracking worktree: no fork risk** (fact): branch `gio/web-app-prod-telemetry-key` is fully merged into main; nothing to reconcile.

Findings that informed this: research/003-structured-errors-groundwork.md
