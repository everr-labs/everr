# Dashboard Feature — Current Status

_Last updated: 2026-06-07 (branch `gio/perses-dashboard-route`)._

Custom dashboards built on a [Perses](https://perses.dev)-compatible data model, backed by Postgres, querying ClickHouse.

## Data model & storage

- ✅ Perses-style `Dashboard` resource (`kind` / `metadata` / `spec` with `panels`, `layouts`) — zod schemas in `packages/app/src/data/dashboards/schema.ts`
- ✅ Postgres tables `dashboards` + `dashboard_folders` (org-scoped, unique slug per org, self-referencing folder nesting, cascade FKs) — `packages/app/src/db/schema/app.ts`
- ✅ Random 12-char dashboard IDs (`[a-z0-9]`, server-generated, Web Crypto). IDs are never derived from names; renaming never changes the URL
- ✅ Create is insert-only (`createDashboard`), save is update-only (`saveDashboard`) — overwriting an existing dashboard by creating a same-named one is impossible
- ✅ `duration` / `refreshInterval` have full UI + runtime support (see Time range below)
- 🟡 Schema defines `datasources` — **no UI or runtime support yet** (schema-only, for Perses compatibility)
- ✅ Dashboard variables (see Variables below)

## Dashboards index (`/dashboards`)

- ✅ Folder tree with arbitrary nesting, expand/collapse, folders-first alphabetical sort, orphan fallback to root
- ✅ Search across dashboards _and_ folders (case-insensitive), flattened results with folder paths (`Production / API`)
- ✅ Create folder / subfolder, rename, move (picker disables the moved folder's own subtree; server enforces a cycle check too)
- ✅ Delete folder: empty → simple confirm; non-empty → recursive content counts with two explicit modes — **Move contents to root** (re-parents direct children, structure preserved) or **Delete everything** (cascade)
- ✅ Dashboard rename / move-to-folder / delete from per-row kebab menus
- ❌ Drag & drop into folders (context-menu move only, by design for v1)
- ✅ Query-error UI — a failed dashboards/folders list query renders an inline error state (icon + message) instead of masquerading as the empty "No dashboards yet" state

## Dashboard page (`/dashboards/$dashboardId`)

- ✅ Grid layout (react-grid-layout, 24 cols): drag, resize, add, remove, duplicate panels; edit mode persisted in the zustand store; floating per-panel toolbar
- ✅ Toolbar kebab (saved dashboards): Rename (atomic — single UPDATE patching only `spec.display.name` via `jsonb_set`, no read-modify-write; applies immediately, updates breadcrumb via `router.invalidate()`), Move to folder, Delete
- ✅ Saving an existing dashboard preserves its folder assignment
- ✅ Not-found route component; breadcrumb from loader data
- ✅ Unsaved-changes protection — dirty tracking in the store, route blocker with Stay / Discard & leave dialog, `beforeunload` on tab close; the panel editor mounts the same blocker so edits stay protected there too
- ✅ Edit-mode toolbar Settings button → Settings page (`/dashboards/$dashboardId/settings`): General section sets per-dashboard default time range + auto-refresh interval; edits are dirty-tracked through the store and persisted via the page's Save

## New dashboard flow (`/dashboards/new`)

- ✅ Save dialog with name input + folder picker (defaults to Root)
- ✅ "New dashboard" from a folder's kebab pre-selects that folder (`?folder=<uuid>` search param)
- ✅ cmd+k command palette actions (new dashboard, dashboard search)

## Panel editing (`/dashboards/$dashboardId/panel/$panelKey`)

- ✅ Full-page editor: live preview (top) + Query / Visualization tabs (bottom), draft-based Apply/Discard
- ✅ ClickHouse SQL editor (CodeMirror, ClickHouse dialect) with Run Query against the org-scoped ClickHouse context
- ✅ Display options: title, description, per-visualization settings
- 🟡 Single query per panel (`queries[0]`), query plugin hardcoded to `ClickHouseSQL`
- ✅ Panel-level error states — grid panels and the editor preview render failed queries with the error message (auto-run and manual Run Query)

## Visualizations (`packages/app/src/components/dashboards/visualizations/`)

- ✅ **TimeSeriesChart** — auto-pivot multi-series, custom portal tooltip, legend, unit, line width, connect-nulls, gap filling, time-range clamping, drag-to-zoom (`onTimeRangeChange`)
- ✅ **Table** — flush-content table view with settings
- ✅ **StatChart** — calculation (last/first/mean/min/max/sum), unit suffix, optional sparkline, absolute/percent threshold coloring (value + sparkline)
- ✅ Unknown panel plugin `kind` — renders a clear "Unknown visualization: \<kind>" placeholder rather than crashing

## Variables

- ✅ `TextVariable` + `ListVariable` with `StaticListVariable` and `ClickHouseSQLVariable` option plugins; `allowMultiple`, `allowAllValue` (+ optional raw `customAllValue`), `display.hidden`, text `constant`
- ✅ Grafana-style tokens in panel SQL — `$name`, `${name}`, `${name:raw}` — interpolated **server-side** in `runPanelQuery` (escaped ClickHouse literals; arrays → parenthesized lists; empty array → `(NULL)`; unknown tokens left untouched) — `packages/app/src/data/dashboards/interpolate.ts`
- ✅ Variable bar (dashboard page + compact in the panel editor): text inputs, single/multi dropdowns, "All" entry; query-backed options load via react-query keyed on query + time range (refresh with the picker); loading spinner, inline error state (tooltip, no toast), "first 1000 shown" truncation note
- ✅ Value state in a single `vars` URL search param (JSON object; All sentinel `"__all"`); URL wins over spec defaults; not retained across navigation by design; back button steps through selections; editor entry/exit forwards `vars`
- ✅ Variables section on the settings page (sections nav + variable list + draft form with Apply/Delete, name regex + uniqueness validation, CodeMirror SQL editor + query preview, confirm-discard on switching with un-applied edits); mutations dirty-tracked through the store, saved with the dashboard Save flow
- ✅ JSON section on the settings page: full Perses model (`{ kind, metadata, spec }`) in a CodeMirror JSON editor; Apply validates (JSON + zod model schema + slug rules for changed names) and stages to the store; `metadata.name` edits rename the URL slug on Save (atomic with the spec write, collision → inline error); new dashboards can pick their slug before first save. Because the editor exposes the full Perses model, the existing v1 boundaries (see 🟡 items in Data model and Panel editing) apply to hand-authored JSON and are silently ignored: `datasources` is accepted for compatibility but has no runtime effect; `queries[]` beyond index 0 are parsed but unused; editing a panel rewrites its query plugin kind back to `ClickHouseSQL`.
- ✅ Panels referencing a variable with no effective value render "Select a value for $name" client-side (query disabled, nothing sent to ClickHouse); All-without-options waits in the pending skeleton
- ✅ `ListVariable` `sort` — applied to picker options (none / alphabetical asc·desc / numerical asc·desc / case-insensitive alphabetical asc·desc); non-numeric values sorted last in numerical modes
- ❌ Not in v1 (tracked follow-ups): variable chaining (variables inside option queries), `capturingRegexp`, Grafana-style `var-<name>` URL aliases, per-panel overrides, variables in panel titles/descriptions

## Time range

- ✅ Global time-range picker (URL search params) drives all panel queries; chart zoom writes back to the URL
- ✅ Per-dashboard `duration` / auto-`refreshInterval` — edited on the settings page (General), saved with the dashboard Save flow; seeds the URL params once per visit when absent (explicit URL params always win, shareable links untouched)

## Testing

- ✅ Unit tests: tree building/search/counts (`tree.test.ts`), grid layout conversion (`convert.test.ts`), server-fn behavior incl. `moveFolder` cycle check, insert-only/update-only split, slug-collision retry, unique-violation mapping, variable interpolation before execution, options-query dedup/cap (`server.test.ts`), store dirty tracking incl. `updateVariables` (`dashboard-store.test.ts`), stat calculations/thresholds (`stat-calculations.test.ts`), duration/refresh seeding (`time-defaults.test.ts`), token interpolation/escaping (`interpolate.test.ts`), effective value resolution (`variable-values.test.ts`), variable draft round-trips/validation (`variable-draft.test.ts`), slug/model schemas (`schema.test.ts`), slug rename/chosen-slug server flows (`server.test.ts`)
- ✅ Full feature browser-verified end-to-end (folder CRUD, all management flows, delete modes, no-overwrite behavior, StatChart, unsaved-changes dialogs + beforeunload, panel error states, settings seeding incl. URL-wins, duplicate-folder error, aria-labels; variables: all three kinds, multi-select + All, URL round-trip + back button, picker-driven refetch, dirty tracking through the settings page, missing-value panel state, options-query error state, hidden variables)

