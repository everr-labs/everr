# @everr/app-cloud

## 0.13.0

### Patch Changes

- c88872a: Zooming a trace or profile flamegraph with a trackpad pinch or Ctrl and the scroll wheel no longer jumps back and forth between two zoom levels. Fast scrolling now zooms smoothly in one direction, and each zoom step draws faster.
- e02352b: TimeSeriesChart panels accept a `colors` map that pins a series to a fixed hex color by name, the same option BarChart and StatChart already have. Series it doesn't name keep their palette color. The Telemetry Usage dashboard uses it so each signal has the same color in "Usage by signal" and "Ingestion volume by signal".
- 893189f: The Telemetry Usage dashboard now counts profiles. Profiles get their own series in "Usage by signal" and "Ingestion volume by signal", and their volume is included in the usage summary and the cumulative chart.
- Updated dependencies [de18796]
- Updated dependencies [81118df]
- Updated dependencies [dfa70b2]
- Updated dependencies [c88872a]
- Updated dependencies [1b11f46]
- Updated dependencies [b075a38]
- Updated dependencies [613692f]
- Updated dependencies [69afc01]
- Updated dependencies [7de8f6d]
- Updated dependencies [f7c6638]
- Updated dependencies [94fc719]
- Updated dependencies [156b94e]
- Updated dependencies [e02352b]
  - @everr/app@0.13.0

## 0.12.0

### Patch Changes

- 429aa0f: Changing a filter, an aggregation, a dashboard variable, or the time range now starts loading the new data right away. Moving between pages also waits on fewer requests, because Everr no longer checks your session, workspace, and access again on every click.

  If your session ends while a page is open (you sign out in another tab, it expires, or it is revoked), the next request now takes you to sign-in right away, and back to the same page after you sign in, instead of failing after several retries. If you lose access to the active workspace, you are sent to choose another one, and if you lose the Owner or Admin role, admin pages show that you are not authorized. When you sign out, sign in again, or switch organization in another tab or window, an open page follows the change on its next request or when you come back to it, and never shows or changes the previous organization's data. A promotion to Owner or Admin, or a restored subscription, takes effect on the next page you open, without a reload.

  When an organization's Pro subscription is suspended, only billing stays available until it is restored: Everr pages, the CLI, `everr apply`, connecting GitHub, the live event stream, and the MCP `query` tool answer that the organization is suspended. An open page now moves to the suspended subscription page on its next request, instead of only on the next navigation.

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

- Updated dependencies [f18d2f9]
- Updated dependencies [f1c87ff]
- Updated dependencies [2433592]
- Updated dependencies [429aa0f]
- Updated dependencies [a05bb7d]
- Updated dependencies [13b4f0d]
- Updated dependencies [a71a366]
- Updated dependencies [45eb6fb]
- Updated dependencies [ea3c434]
- Updated dependencies [429aa0f]
- Updated dependencies [8cccd01]
- Updated dependencies [36fbc99]
- Updated dependencies [04315d5]
- Updated dependencies [dcfa61c]
- Updated dependencies [a7c27db]
- Updated dependencies [0ef2b13]
- Updated dependencies [6e37afb]
- Updated dependencies [0dca9db]
- Updated dependencies [5b7e96a]
- Updated dependencies [adfca0c]
  - @everr/app@0.12.0

## 0.11.0

### Patch Changes

- Updated dependencies [33fe03c]
  - @everr/app@0.11.0
