# @everr/app

## 0.12.0

### Minor Changes

- 2433592: Public keys can now be copied again after creation: each row in the **Public keys** section of the API keys page has a **Copy key** button, and clicking the key's prefix shows the full key. A key with more than two allowed origins now lists them all when you click its **+N**. Public keys created before this release can't be shown again, because only a hash of them was stored. To get a copyable one, create a new public key and replace the old one in your frontend config. Secret keys are still shown only once.

  API keys can no longer be created or changed through the raw `/api/auth/api-key/create` and `/api/auth/api-key/update` endpoints. Use the API keys page, which validates a public key's allowed origins.

- 8cccd01: Heatmap panels have a new `xColumn` option. When it's set, the x-axis shows that column's values as categories instead of time, so a panel can show a grid like hour of day × weekday or region × tier without a time column. Numeric values, like hours, sort from smallest to largest left to right. Other values keep the order your query returns them in. These panels don't support drag-to-zoom, and the tooltip shows the x label. Heatmaps without `xColumn` work as before.
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

- 0dca9db: Panel colors you set in dashboards and runbooks must now be opaque hex colors such as `#fff` or `#22c55e`, so text drawn on a colored fill always gets a readable foreground. This covers StatChart and GaugeChart `thresholds.defaultColor` and `thresholds.steps[].color`, and the `colors` map of StatChart, BarChart, StateTimeline, and StatusHistory. `everr apply` rejects resources that use named colors, `rgb()`, `hsl()`, CSS variables, or hex with alpha (`#22c55e80`) in these fields. A saved panel that still uses one of these colors renders without that option (no thresholds, or the default palette) and shows a warning until you reapply it with hex colors.

### Patch Changes

- f18d2f9: The self-hosted app's own server and browser telemetry now reports the release version as `service.version`. Before, the server left it out and the browser reported `0.0.0-dev`. Set `SERVICE_VERSION` at runtime to override the server value.
- f1c87ff: CLI commands that use a saved session, such as `everr cloud query`, `everr cloud status` and `everr resources`, now report "Session expired. Run `everr cloud login` to re-authenticate." when the session is missing, revoked or expired, instead of failing with `500 Internal Server Error`. When the session has no active organization, or the user is no longer a member of it, the server now answers `403 Forbidden` with the reason instead of a 500.
- 429aa0f: Dashboard panels now agree on the current time: every panel on a dashboard reads the time range at the same moment, including panels that load as you scroll and panels that re-run when you change a variable. Refreshing, or changing the time range, moves them all to the new time together.

  Time series, heatmap, state timeline and status history panels also start their range on a whole interval, so the first point covers a full interval instead of reading low at the left edge. The chart still ends at the current time. Stat panels and their sparklines, tables and other totals keep the exact time range.

- a05bb7d: A relative time range that ends before it starts, such as "today until 5 hours ago" opened before 05:00, no longer sends queries or shows errors on the Explore pages (Logs, Traces, Errors, Metrics), in Everr and in the local explorer, or on Runs in Everr.

  - The pages show their empty state.
  - The time range picker turns red, and its tooltip says the range ends before it starts.
  - In Everr, such a range is no longer swapped into a different one when you open a page. Two dates in the wrong order still are.

- 13b4f0d: A link whose time range starts and ends at the same fixed instant now opens with an empty range. It used to fail with "Too many redirects".
- a71a366: Opening an error from the Errors page now shows its detail as a full page, the same way traces and metrics open, instead of in a modal. The back button returns to the Errors list with your filters kept. This applies in Everr and in the local explorer.

  Rows in the Errors list are now the same height as rows in the Traces list. The Trend column is now a heatmap strip: every row has the same time cells, lined up in columns down the list, and a busier interval is a stronger shade on one scale shared by all rows, so you can spot errors that started in the same window.

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

- 429aa0f: Changing a filter, an aggregation, a dashboard variable, or the time range now starts loading the new data right away. Moving between pages also waits on fewer requests, because Everr no longer checks your session, workspace, and access again on every click.

  If your session ends while a page is open (you sign out in another tab, it expires, or it is revoked), the next request now takes you to sign-in right away, and back to the same page after you sign in, instead of failing after several retries. If you lose access to the active workspace, you are sent to choose another one, and if you lose the Owner or Admin role, admin pages show that you are not authorized. When you sign out, sign in again, or switch organization in another tab or window, an open page follows the change on its next request or when you come back to it, and never shows or changes the previous organization's data. A promotion to Owner or Admin, or a restored subscription, takes effect on the next page you open, without a reload.

  When an organization's Pro subscription is suspended, only billing stays available until it is restored: Everr pages, the CLI, `everr apply`, connecting GitHub, the live event stream, and the MCP `query` tool answer that the organization is suspended. An open page now moves to the suspended subscription page on its next request, instead of only on the next navigation.

- 36fbc99: Heatmap panels with `xColumn` now keep a column and row for every row your query returns, even when its value is empty. An empty value draws as an empty cell instead of removing that x value or bucket from the axes. To keep the same layout on every time range, such as all 7 weekdays × 24 hours, return the full grid with `NULL` where nothing reported.
- dcfa61c: On the Metrics page, hovering a series in the table under the chart highlights its line in the chart and dims the others. This works in Everr and in the local explorer.

  Chart lines are now 1px wide. Dashboard time series panels default to a `lineWidth` of `1` instead of `1.5`; a panel that sets `lineWidth` keeps its value.

- a7c27db: Opening a link to a dashboard, runbook or other resource that doesn't exist now shows the not-found page right away, instead of after about 7 seconds.
- 0ef2b13: `everr apply` with a logged-in session and the live event stream now check that you are still a member of your active organization. If you were removed from it, they answer `403 Forbidden` instead of acting on that organization.
- 6e37afb: The refresh button now reloads only the page's data: dashboard panels, charts, Explore results, runs and alerts. It no longer refetches the session, settings, dashboard and runbook definitions or filter value lists, so auto-refresh sends fewer requests. Those still update on their own, for example when you return to the tab. The one exception is the dashboard you have open: reload the page to see changes you just applied to it.

  The button also spins only while that data loads, whether a refresh, a time range change or opening the page started the load. It used to spin for every request in flight.

- 5b7e96a: Pages no longer jump around while they load.

  - Moving between pages keeps the current page on screen, with a thin progress bar at the top, until the next one is ready, instead of a full-page spinner. The breadcrumb names the page you are going to right away, including a dashboard's or runbook's name when you open it from its list.
  - Loading placeholders now match what replaces them: the Logs, Traces and Errors lists, the alerting rules list and rule detail, dashboard and runbook lists, the trace viewer, the Metrics catalog and the filter pickers keep their columns, row heights and headers when the data arrives.
  - Changing a filter or the time range keeps the current results on screen, dimmed, until the new ones arrive, on the Explore pages, alerting pages and error details, instead of clearing them to a placeholder.
  - Navigating between pages is faster: the app no longer redraws its sidebar and top bar several times on every navigation.
  - Home shows your dashboard straight away instead of a placeholder while it checks your setup.
  - Settings pages (account, members, API keys, GitHub) load their data with the page instead of after it.
  - Dialogs and side panels (new channel, edit delivery, new silence, change role, alert and log details on small screens) now animate out when closed instead of vanishing.
  - In Safari, the separators in the Metrics list and series table are no longer brighter than in the other lists.
  - Log and trace timestamps no longer wrap onto two lines in Safari, and the log severity counts stay blank instead of showing "—" until they load.

- adfca0c: Calendar time ranges such as "Today", "Yesterday", "This week" and "This month so far" now cover your local day, week or month on every page: Logs, Runs, dashboards, workflows, repositories, cost analysis and alerting. They used to cover the UTC day on these pages, so outside UTC+0 the results didn't match the dates shown in the time picker. The Service, Environment and attribute filter lists follow the same window. Relative ranges such as "Last 1 hour" now use your device's clock on every page, as Traces and Errors already did.

  Bars in the Logs and Runs volume histograms and the cost analysis Actions usage chart now start at your local midnight and on your local hour, instead of at UTC boundaries, and the Actions usage chart labels them in your time zone.

- Updated dependencies [fe4c28d]
- Updated dependencies [2aef930]
  - @everr/otel-web@0.12.0
  - @everr/otel-errors@0.12.0
  - @everr/tanstack-start-otel@0.12.0

## 0.11.0

### Patch Changes

- 33fe03c: Self-hosted Everr is now published to the GitHub Container Registry as `ghcr.io/everr-labs/everr-app` and `ghcr.io/everr-labs/everr-collector`. ClickHouse runs the stock `clickhouse/clickhouse-server` image, and the app applies its schema on startup. The Compose bundle in `deploy/` pulls these images, pinned to the release. Everr's CLI, libraries, and apps now share one version.
- Updated dependencies [38a0459]
  - @everr/otel-web@0.11.0
  - @everr/otel-errors@0.11.0
  - @everr/tanstack-start-otel@0.11.0
