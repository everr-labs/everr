# @everr/cli

## 0.12.0

### Minor Changes

- 04315d5: Explore has a new **Metrics** page, in Everr and in the local explorer opened by `everr local start`. In Everr it's listed first in the Explore sidebar, followed by Logs, Traces and Errors.

  - **Catalog:** lists every metric your services send in the time range, with its type, unit, data point count and when it last reported. Search by name or filter by type.
  - **Charts:** open a metric to chart it.
    - Gauges show avg, min, max or sum.
    - Counters show a per-second rate or the increase per interval, and cumulative counters stay correct across process restarts.
    - UpDownCounters show the sum across series.
    - Histograms show p50, p95 or p99 (worked out from bucket counts), the average or the observation rate, plus a heatmap of observations per bucket over time.
    - Exponential histograms chart the same way as histograms, and stay exact when an SDK changes their scale.
    - Summaries chart the quantiles your SDK reports, the average and the rate. An SDK computes a summary's quantiles per instance, so a line that covers several instances shows the highest of them. Group by instance to see each one.
  - **Mixed bucket bounds:** when the series in one line report different bucket bounds, for example two services on different SDK versions, they're combined on one set of bounds. A note says whether the percentiles are exact or estimated.
  - **Exemplars:** when your SDK records exemplars, the chart marks the slowest sampled request in each interval with a diamond. Click one to open its trace or its logs.
  - **Resolution:** a chart is never finer than how often the metric is exported, so a metric sent every 15 minutes draws a line rather than scattered points. The header shows the chart's resolution.
  - **Several queries:** add up to three more metrics to the same chart, each with its own aggregation, grouping and filters. Hide any of them without losing its setup, or click a metric's name to switch it to another.
  - **Reloading:** a chart stays on screen while it reloads, and dims if the reload takes more than a moment. A query you didn't change keeps its data, so adding a copy of a query or editing one of several doesn't reload the others. Their latest interval can hold slightly less data than the query you changed, and refreshing brings every query up to date.
  - **Grouping and zoom:** group the chart by up to three attributes, filter by attribute values, and drag across the chart to zoom. As on dashboards, each zoom adds a history entry, so Back returns to the previous range.
  - **Filters:** Service and Environment carry over from the other Explore pages. Their menus on every Explore page now include services and environments that send only metrics.

### Patch Changes

- a05bb7d: A relative time range that ends before it starts, such as "today until 5 hours ago" opened before 05:00, no longer sends queries or shows errors on the Explore pages (Logs, Traces, Errors, Metrics), in Everr and in the local explorer, or on Runs in Everr.

  - The pages show their empty state.
  - The time range picker turns red, and its tooltip says the range ends before it starts.
  - In Everr, such a range is no longer swapped into a different one when you open a page. Two dates in the wrong order still are.

- 45eb6fb: Zooming by dragging across a chart now works the same on dashboards, on the Logs page and on Runs. Logs changes in Everr and in the local explorer.

  - A click no longer zooms, and neither does a press that moves only up or down. A drag must select at least one second.
  - On Logs and Runs, each zoom adds a history entry, so Back returns to the previous range. It used to replace it.
  - The selection looks the same as on dashboards, and the mouse pointer stays the default arrow.
  - On a touch screen, tapping or sliding a finger sideways across the Logs and Runs volume charts shows the values under it, as on dashboard charts. Vertical swipes still scroll the page.

- ea3c434: Explore and chart fixes:

  - **Auto-refresh in Everr:** Logs, Traces and Errors now fetch their data once per interval instead of twice.
  - **Local trace view:** a trace no longer refreshes on its own when you open it from a Traces page with auto-refresh on, as in Everr. Reopen it or reload the page to see spans that arrived later.
  - **Filter focus:** clearing a Service or Environment filter with the keyboard now leaves focus on the filter, so the next Tab continues from there instead of from the top of the page.
  - **Isolated points in Everr:** line and area charts, including dashboard time series panels and the repository and run charts, now draw a dot for a point with no data on either side. Such a point used to be invisible, so a series that reported once in the range looked empty.

- adfca0c: In the local UI started by `everr local start`, bars in the Logs volume histogram now start at your local midnight and on your local hour, instead of at UTC boundaries.
- dcfa61c: On the Metrics page, hovering a series in the table under the chart highlights its line in the chart and dims the others. This works in Everr and in the local explorer.

  Chart lines are now 1px wide. Dashboard time series panels default to a `lineWidth` of `1` instead of `1.5`; a panel that sets `lineWidth` keeps its value.

## 0.11.0

### Minor Changes

- 3c8c381: Rewrite the CLI in Go. `everr local start` now runs the collector and chDB inside the CLI process instead of extracting and spawning a separate collector binary, and commands other than `everr local start` no longer load the chDB library.

  Remove `everr ci`. GitHub Actions runs, jobs, steps, and their logs are telemetry in Everr, so query them with `everr cloud query`. Run `everr skills update` after upgrading, because the installed `everr-working-with-ci` skill still tells agents to run `everr ci`.

## 0.10.1

### Patch Changes

- d0cdd9f: Fix direct trace links getting stuck loading. Resolve trace bounds by ID so traces load independently of URL time ranges, and remove unnecessary timestamps from trace links.
- 85e4c55: Fix trace span selection scrolling. Direct clicks keep the clicked view in place while revealing the span in the other view, and URL updates preserve the viewer's scroll position.
- 6d99746: CLI and local UI usage telemetry to Everr cloud, sanitizing customer data. Application telemetry and `everr wrap` output remain local.
- 1b919aa: Add `everr local ui` to open the running local UI in the default browser.
  Add `everr cloud status` to validate the current session and display the current user.
- 40fe053: The `everr-setup-resources` skill now checks each panel and alert query with `EXPLAIN indexes = 1` and `EXPLAIN ESTIMATE` over the long range, and filters on the table's leading sort-key columns until it reads fewer granules.

## 0.10.0

### Minor Changes

- 0ecdfff: Replace the desktop app with a bundled local browser UI served by `everr local start`. Explore local logs, traces, and errors without an account, with optional Cloud sign-in and collector settings in one CLI installation.

## 0.9.0

### Minor Changes

- e4a1649: Replace the desktop trace detail modal with a full-page trace explorer. Add synchronized waterfall and collapsible flamegraph views, span search and category/error highlighting, attribute previews, zoom and pan, resizable span details, and a flamegraph time guide. Move trace model preparation and flamegraph layout into workers.

## 0.8.3

### Patch Changes

- dc5acfa: The `everr-setup-telemetry` Next.js rule now turns off incoming request tracing in the HTTP instrumentation and uses the server span that Next.js makes for each request. Next.js creates its HTTP server before `register()` runs, so the HTTP instrumentation missed requests. The rule also sets `NEXT_OTEL_FETCH_DISABLED=1`, so each `fetch` is traced once and not twice.
  - @everr/otel-web@0.3.3

## 0.8.2

### Patch Changes

- d301d9e: Fix local collector batch rejection when spans contain events or links, including BullMQ's `job completed` event. Preserve event and link attributes as JSON objects with their original value types.
- Updated dependencies [21b3838]
- Updated dependencies [2ecad0b]
  - @everr/otel-web@0.3.2

## 0.8.1

### Patch Changes

- Updated dependencies [bf3cdea]
- Updated dependencies [34eb270]
  - @everr/otel-web@0.3.1

## 0.8.0

### Minor Changes

- 225d265: Update the bundled CLI skills for the current telemetry and resource formats. Trace and log query guidance now uses JSON attributes, while metric queries retain Map access. Dashboard and runbook guidance covers unified `valueFormat` options, OpenTelemetry units, numeric scaling, table column formatting, and shared time-range defaults.

### Patch Changes

- 1238863: Refresh the CLI help text and command reference to match the current telemetry, CI, Skills, and resources-as-code command surface.
- Updated dependencies [bbbf091]
  - @everr/otel-web@0.3.0

## 0.7.0

### Minor Changes

- 738c9de: Every Explore filter now sits in one rail on Traces, Logs and Errors. Service and Environment move out of the toolbar under the title bar, and the search field moves out of its own bar above the results, so the whole query reads in a single column.

  The rail has two zones. The top zone holds Service and Environment, which stay set as you move between the three pages. Everything below the divider belongs to the current page and is reset by `Clear page filters`, which no longer skips the search field the way `Clear all` did. In a narrow window the rail moves into a sheet behind a `Filters` button that shows how many filters are active.

  Trace rows also change. The HTTP method of the root span renders as a badge, in one tone for methods that read and another for methods that change state. The service moves into its own column next to its colour dot. A new status column replaces the span count: it shows the HTTP response status code when the root span has one, and OK or Error otherwise. Its colour comes from whether any span in the trace failed, which matches what the Status filter selects, so a 404 that the service handles stays green. The warning triangle is gone, since the status column now carries that state.

### Patch Changes

- Updated dependencies [3dd9174]
  - @everr/otel-web@0.2.0

## 0.6.0

### Minor Changes

- 415f479: Add `everr resources` to inspect and manage live Cloud resources (dashboards, runbooks, alert rules) directly, alongside the declarative `everr apply`:
  - `everr resources list [--kind] [--repoid] [--json]`: list live resources across the organization, with the repoid that owns each one.
  - `everr resources show <kind> <slug> [--project] [--json]`: print a resource's stored config (YAML by default, or `--json`).
  - `everr resources delete <kind> <slug>`: delete a live resource (non-interactive).
  - `everr resources adopt <kind> <slug>`: reassign a resource's repoid to this repository.

  `everr apply` now also prints the resolved repoid before the plan.

### Patch Changes

- 1dc5b24: The `everr-setup-telemetry` skill now covers direct browser ingestion: a new `browser` rule explains public origin-bound ingest keys, endpoint gating for keyless deploys, error capture, and validation. The old guidance saying all browser telemetry must proxy through a backend now applies to secret keys only.

## 0.5.1

### Patch Changes

- 6db6c82: Fix logs queries failing with `Unknown identifier TimestampTime` on installs whose local schema predates the column. The local collector previously wrote to `otel_*` tables and exposed them through plain views named after the cloud tables (`logs`, `traces`, `metrics_*`); those views froze their column set at creation, so views created before the `TimestampTime` column kept rejecting it even after the underlying table gained it. The collector now writes directly to tables carrying the cloud names — no views. On first startup with the new layout the legacy views are dropped and the `otel_*` tables are renamed into their place, so previously collected local telemetry is preserved. The idempotent `TimestampTime` column migration still runs on every startup, covering adopted tables and any logs table that predates the column.

## 0.5.0

### Minor Changes

- e2ff9f5: Rebuild the CI page as a full runs explorer: a filter sidebar (status, branch, workflow) with the Repository filter in the topbar and a "Your runs" toggle on by default, a runs-over-time volume histogram, infinite scroll, live-ticking durations for in-progress runs, and the copy auto-fix prompt on failed runs. The window now has a single full-width title bar so the left nav stays in the same place whether windowed or fullscreen.
- f533a74: Surface app updates and gate installs behind user action: a sidebar update button, a green status badge on the tray icon, and a "Restart to update" tray menu item now appear when an update is staged, and the update installs only when the user triggers it. A vanished staged artifact (e.g. removed by OS temp cleanup) now self-heals by re-downloading instead of getting stuck.

## 0.4.7

### Patch Changes

- eed341a: Update CLI help text to reflect Everr's unified observability positioning instead of CI/CD-specific framing. The top-level `about` description now reads "CLI for observability in Everr" and the cloud `query` command describes running SQL against "cloud telemetry data" rather than "cloud CI data".
- 48ce4e3: Fix "Failed to load logs" in the logs explorer. The embedded collector's local `otel_logs` table was missing the `TimestampTime` column that log queries filter on, so every query failed with `Unknown identifier TimestampTime`. New installs now create the column, and existing installs are migrated on startup with an idempotent `ADD COLUMN IF NOT EXISTS`.
- 2965171: Fix the `upgrade.sh` script to run on Linux (e.g. Ubuntu) by making it POSIX `sh` compatible. It previously used `set -o pipefail`, which fails under `dash` (the default `/bin/sh` on Ubuntu), so `curl … | sh` aborted before upgrading. It now matches `install.sh` with a `#!/bin/sh` shebang and `set -eu`.

## 0.4.6

### Patch Changes

- f066c2a: Fix `everr local start` on Linux by embedding the collector and chDB assets in the published Linux CLI release (the build now fails if the assets are missing). Also make the install script configure your shell PATH automatically instead of only printing a hint.

## 0.4.5

### Patch Changes

- 7220fea: Add project-scoped alert definitions and notebook runbook links in alert views and Slack/Telegram notifications.
- 851624e: Update bundled alert skills, docs, and example Everr definitions for runbook-linked alerts and the `everr/` apply tree.
- 72d7209: Separate the capabilities of `ek_` API keys into two scopes: `ingest` (send
  OpenTelemetry data) and `apply` (run `everr apply` against dashboards,
  notebooks, and alerts). The collector's verify endpoint and the apply
  endpoint each check the matching scope; a key minted for one capability
  is now refused when used for the other.
  - New keys are minted with both scopes checked by default, but the
    **New API key** dialog now exposes a Capabilities section so you can
    mint a key with just one scope (for example, an `ingest`-only key for a
    public collector, or an `apply`-only deploy key for CI).
  - Keys minted before this change keep working — a key with no scope map
    is treated as fully scoped.
  - The Ingest Keys page is now called **API keys** (the old `/ingest-keys`
    URL redirects), and its table gains a per-row Capabilities column so you
    can see what each key is authorized for.
  - The CLI now reads `EVERR_API_KEY` for the apply command (preferred).
    `EVERR_API_TOKEN` is still accepted as a deprecated alias so existing
    CI setups keep working.

- e1fe7cc: Preserve collector failure reason (exit status, spawn error) in telemetry as `everr.collector.failure_reason` attribute instead of discarding it.
- e5b4c53: Suppress expected production telemetry noise from auth/control-flow paths, SQL API query errors, stale GitHub installations, and desktop notifier reconnects.

## 0.4.4

### Patch Changes

- 5a228b6: Fix a crash when opening the Errors page in the desktop app with no Service filter selected (the shared Service/Environment filters read an undefined value).

## 0.4.3

### Patch Changes

- 28e8199: Retry release with NPM_TOKEN authentication.
- Updated dependencies [28e8199]
  - @everr/auto-otel-errors@0.2.3

## 0.4.2

### Patch Changes

- 6b94d92: Retry release with NPM_TOKEN authentication.
- Updated dependencies [6b94d92]
  - @everr/auto-otel-errors@0.2.2

## 0.4.1

### Patch Changes

- 34d39ac: Fix npm package publishing to use trusted publishing.
- Updated dependencies [34d39ac]
  - @everr/auto-otel-errors@0.2.1

## 0.4.0

### Minor Changes

- 8bd4e84: Add a shared Explore topbar to the desktop app: Service and Environment filters move out of each page's sidebar into a toolbar above Logs, Errors, and Traces, and persist as you navigate between the three pages.

### Patch Changes

- Updated dependencies [34e86aa]
  - @everr/auto-otel-errors@0.2.0

## 0.3.2

### Patch Changes

- 84b0397: Temporarily disable everr-action release pipeline (bundled CLI binary exceeds GitHub 100 MB file limit)

## 0.3.1

### Patch Changes

- 47014e1: Publish bundled CLI assets to the action repository during desktop releases and let the action install the matching bundled CLI for supported runners.
- 12d63c0: Keep trace and error lists mounted while opening detail dialogs so closing a detail preserves the list state, and reserve the macOS titlebar space in windowed dialogs.

## 0.1.31

### Patch Changes

- 7eb2635: Refresh stale query data when the window regains focus and cap cached
  results at 30s instead of holding them forever. Previously the desktop
  app kept the first response in memory indefinitely and never refetched
  when reopened, so runs and notification settings could appear out of
  date until the app was restarted.
