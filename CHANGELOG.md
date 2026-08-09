
## 2026-07-20

### `everr resources` CLI

New `everr resources` subcommand to manage as-code resources from the terminal: `list` (filterable by kind and project, with `--json`), `show`, `delete`, and `adopt` to transfer ownership of a resource to the current repo.

### `everr.yaml` is now optional

`everr apply` no longer requires a manifest: the repoid is inferred from the `origin` git remote. An existing `everr.yaml` always wins and remains the escape hatch for local-only repos and explicit pins.

### Errors

- Error grouping now runs through a single ClickHouse function, `errorFingerprint`, shared by cloud and the local collector, so fingerprints are identical everywhere.
- The error dialog has a new "Copy agent prompt" button: it copies a ready-to-run prompt with the error's fingerprint and an `everr cloud query` / `everr local query` that lists its occurrences, so an AI agent can pull the full context from telemetry.
- The [everr-use-telemetry](/docs/reference/skills) skill gained an Errors and Triage section covering the `everr cloud errors` commands and the fix-loop workflow.

### Docs restructure

The docs between Getting started and Reference are reorganized into [Concepts](/docs), Guides, and Reference. Dashboards, alerts, and runbooks are documented as one interleaved as-code system, and the docs home page is a new "What Everr is" overview.

### Pricing page

New [pricing page](/pricing) with Free / Pro / Enterprise tiers and an interactive cost calculator comparing Everr against Grafana Cloud, Datadog, and Sentry.

### Browser telemetry

- The `everr-setup-telemetry` skill now covers direct browser ingestion with public keys: origin-bound, ingest-only keys that are safe to ship in client bundles.
- The production web app ships with browser error tracking enabled.

### CLI tracing

The CLI now opens a trace per command, so a single `everr cloud query` invocation can be followed as one trace across the CLI, the server, and ClickHouse. Failures are classified so user SQL mistakes no longer count as system errors.

### Look and feel

- The whole product (app, docs, UI) now uses Instrument Sans for both headings and body.
- The installed PWA is now named "Everr" instead of the starter template name.

## 2026-07-04

### `everr upgrade`

New `everr upgrade` command to upgrade both the CLI and the Desktop App

### Resource empty states

Alerts, dashboards, and runbooks pages now show an empty state that provide instructions on how to create them.

### Learning path

Improved the getting started docs, to provide a full learning path.

### Desktop app

Local collector tables renamed to match directly the cloud tables, and removed the views we used as prev workaround.

This should fix the issue that some users are facing due to a missing TimestampTime column

## 2026-07-01

### MCP server

Introduced a new [MCP server](/docs/reference/mcp) at `/mcp` with a `query` tool that runs SQL against your telemetry from AI agents, plus a `whoami` introspection tool.

### Notebooks → Runbooks

- Renamed across the entire product — UI, docs, routes, navigation, and [alert definitions](/docs/alerts).
- Backwards-compatible aliases: `notebook` field in legacy alert specs and the `Notebook` kind still work.

### CI Runs Explorer

- Runs page rebuilt as a filter-driven [explorer](/docs/guides/debug-ci) with infinite scroll. Repository filter in the topbar with a "Your runs" toggle.
- Runs explorer is now a shared component used in both the web app and desktop app.
- Workflows list page removed; workflow names link directly to their detail views.

### Dashboard Performance

- [Dashboard](/docs/dashboards) panel queries are deferred until the panel scrolls into view.
- In-flight panel queries are staggered so dashboards don't flood the database.

### Desktop App

- CI page with the shared runs explorer; auth required only on the CI page (rest of the app is freely accessible).
- Unified top title bar with consistent fullscreen/windowed spacing.
- Nav reordered to Logs / Traces / Errors / CI / Settings; default route is now `/logs`.
- Skills install/status in Settings; Sign In available from the account menu.
