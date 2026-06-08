# Dashboard v1 Polish — Design

_Date: 2026-06-05. Branch: `gio/dashboard-v1-polish` (off `gio/perses-dashboard-route`)._

Completes the missing pieces identified in `DASHBOARD_FEATURES.md`: StatChart renderer, unsaved-changes protection, panel-level error states, per-dashboard `duration`/`refreshInterval`, and the known rough edges. Explicitly out of scope (deferred by design): drag & drop into folders, index-page query-error UI, multiple queries per panel, dashboard variables/datasources.

## 1. StatChart (full Perses-style)

New `packages/app/src/components/dashboards/visualizations/stat-chart/` with `stat-chart-visualization.tsx` and `stat-chart-settings.tsx`, registered in `visualizations/index.tsx`. The picker entry already exists in `viz-options.tsx`.

**Spec** (Perses-compatible, stored in `plugin.spec`):

- `calculation`: `last` | `first` | `mean` | `min` | `max` | `sum` (default `last`)
- `unit`: free-text suffix, same convention as TimeSeriesChart
- `sparkline`: boolean (default off)
- `thresholds`: `{ mode: "absolute" | "percent", defaultColor?, steps: [{ value, color }] }`

**Rendering:**

- Reuse TimeSeriesChart's time/numeric column detection. The first numeric column is the value series; `calculation` reduces it to one number, formatted with the unit suffix.
- The value is colored by the highest threshold step it meets or exceeds; below all steps it uses `defaultColor` (falls back to the normal foreground). `percent` mode evaluates step values as a percentage of the series max.
- Sparkline: small recharts line/area of the value series under the number — no axes, no tooltip, fills panel width.
- Empty/no-numeric-column result renders the same empty state pattern as TimeSeriesChart.

**Settings UI** (existing settings-panel pattern): calculation select, unit input, sparkline switch, thresholds editor (add/remove rows of value + color swatch, ordered by value).

## 2. Unsaved-changes protection

- Add `isDirty` to the zustand store (`data/dashboards/dashboard-store.ts`). Set by `updatePanel`, `updateLayout`, panel add/remove/duplicate, and editor Apply. Cleared by `setDashboard` (load/reset) and after a successful save.
- TanStack Router `useBlocker` on `/dashboards/$dashboardId`: blocks in-app navigation while dirty, **except** to the same dashboard's panel editor (`/dashboards/$dashboardId/panel/*`), which is part of editing. Confirm dialog: **Stay** / **Discard & leave**; discard resets the store from loader data and proceeds.
- `beforeunload` handler registered while dirty, for tab close/reload.
- The panel editor mounts the same blocker (scoped to leaving `/dashboards/<id>` entirely), so a dirty dashboard stays protected while editing a panel.
- Server-side actions (rename/move/delete) are unaffected; rename already updates the store via `router.invalidate()`.

## 3. Panel-level error states

- `dashboard-panel.tsx` currently collapses query status to pending/success. Map `useQuery`'s error state to `PanelShell`'s existing `error` status; add an optional error-message line to the shell's error rendering.
- Panel editor preview (`panel-edit-page.tsx`): render the same error UI in the preview region for both the auto-run saved query and manual Run Query failures (today errors only toast; the preview silently keeps stale data).

## 4. Per-dashboard `duration` / `refreshInterval` (defaults; URL wins)

Both fields already exist in the zod schema as optional Perses duration strings (e.g. `1h`, `30s`).

- **Time range:** when the dashboard route URL has no explicit `from`/`to`, seed `from=now-<spec.duration>&to=now` via a one-time replace-navigation per dashboard visit (falling back to `DEFAULT_TIME_RANGE` when `duration` is unset). Explicit URL params always win, and links that carry `from`/`to` are never rewritten — only param-less visits are seeded. Seeding the URL (rather than resolving silently) keeps the global header time-range picker consistent with what panels query.
- **Auto-refresh:** the `_dashboard` layout header already mounts a global `RefreshPicker` + `useAutoRefresh` driven by `?refresh=` — no new toolbar picker needed. Seed `?refresh=<spec.refreshInterval>` the same way when absent and the value is a supported interval.
- **Editing:** new "Dashboard settings" item in the toolbar kebab (saved dashboards only) opens a dialog with duration and refresh-interval selects. Applies immediately via a read-modify-write server fn following the `renameDashboard` pattern — works outside edit mode and does not interact with dirty tracking. The same accepted concurrency caveat as rename applies (full-spec clobber window at current scale).

## 5. Rough edges

- **Friendly duplicate-folder error:** catch PG unique violations (code `23505`) in `createFolder` / `renameFolder` and rethrow as "A folder with this name already exists here". Toasts surface the message via the existing `onError` pattern.
- **Slug-collision retry:** `createDashboard` retries slug generation up to 3 times on unique violation before surfacing an error.
- **a11y:** add `aria-label`s to tree-row and toolbar kebab triggers and to expand/collapse chevrons in `dashboard-tree.tsx` and the dashboard toolbar.

## 6. Testing

TDD throughout, following existing patterns (`server.test.ts` db-mock builders, plain unit tests for pure logic):

- Stat calculation + threshold resolution (pure helpers, unit-tested)
- Duration → effective-range seeding helper
- Slug retry and unique-violation mapping (server fn tests)
- Store dirty-state transitions
- Final browser verification of all five areas against the dev server on :5173, then update `DASHBOARD_FEATURES.md` statuses.
