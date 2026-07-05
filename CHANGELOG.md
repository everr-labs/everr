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

- Runs page rebuilt as a filter-driven [explorer](/docs/ci-insights/debug-ci) with infinite scroll. Repository filter in the topbar with a "Your runs" toggle.
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
