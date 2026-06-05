# Dashboard Feature — Current Status

_Last updated: 2026-06-05 (branch `gio/perses-dashboard-route`)._

Custom dashboards built on a [Perses](https://perses.dev)-compatible data model, backed by Postgres, querying ClickHouse.

## Data model & storage

- ✅ Perses-style `Dashboard` resource (`kind` / `metadata` / `spec` with `panels`, `layouts`) — zod schemas in `packages/app/src/data/dashboards/schema.ts`
- ✅ Postgres tables `dashboards` + `dashboard_folders` (org-scoped, unique slug per org, self-referencing folder nesting, cascade FKs) — `packages/app/src/db/schema/app.ts`
- ✅ Random 12-char dashboard IDs (`[a-z0-9]`, server-generated, Web Crypto). IDs are never derived from names; renaming never changes the URL
- ✅ Create is insert-only (`createDashboard`), save is update-only (`saveDashboard`) — overwriting an existing dashboard by creating a same-named one is impossible
- 🟡 Schema defines `variables`, `datasources`, `duration`, `refreshInterval` — **no UI or runtime support yet** (schema-only, for Perses compatibility)

## Dashboards index (`/dashboards`)

- ✅ Folder tree with arbitrary nesting, expand/collapse, folders-first alphabetical sort, orphan fallback to root
- ✅ Search across dashboards *and* folders (case-insensitive), flattened results with folder paths (`Production / API`)
- ✅ Create folder / subfolder, rename, move (picker disables the moved folder's own subtree; server enforces a cycle check too)
- ✅ Delete folder: empty → simple confirm; non-empty → recursive content counts with two explicit modes — **Move contents to root** (re-parents direct children, structure preserved) or **Delete everything** (cascade)
- ✅ Dashboard rename / move-to-folder / delete from per-row kebab menus
- ❌ Drag & drop into folders (context-menu move only, by design for v1)
- ❌ Query-error UI (failed list queries render a blank body — pre-existing pattern)

## Dashboard page (`/dashboards/$dashboardId`)

- ✅ Grid layout (react-grid-layout, 24 cols): drag, resize, add, remove, duplicate panels; edit mode persisted in the zustand store; floating per-panel toolbar
- ✅ Toolbar kebab (saved dashboards): Rename (applies immediately, updates breadcrumb via `router.invalidate()`), Move to folder, Delete
- ✅ Saving an existing dashboard preserves its folder assignment
- ✅ Not-found route component; breadcrumb from loader data
- ❌ Unsaved-changes protection — no dirty tracking, route blocker, or `beforeunload`; navigating away silently discards edits

## New dashboard flow (`/dashboards/new`)

- ✅ Save dialog with name input + folder picker (defaults to Root)
- ✅ "New dashboard" from a folder's kebab pre-selects that folder (`?folder=<uuid>` search param)
- ✅ cmd+k command palette actions (new dashboard, dashboard search)

## Panel editing (`/dashboards/$dashboardId/panel/$panelKey`)

- ✅ Full-page editor: live preview (top) + Query / Visualization tabs (bottom), draft-based Apply/Discard
- ✅ ClickHouse SQL editor (CodeMirror, ClickHouse dialect) with Run Query against the org-scoped ClickHouse context
- ✅ Display options: title, description, per-visualization settings
- 🟡 Single query per panel (`queries[0]`), query plugin hardcoded to `ClickHouseSQL`
- ❌ Panel-level error states for failed queries are minimal

## Visualizations (`packages/app/src/components/dashboards/visualizations/`)

- ✅ **TimeSeriesChart** — auto-pivot multi-series, custom portal tooltip, legend, unit, line width, connect-nulls, gap filling, time-range clamping, drag-to-zoom (`onTimeRangeChange`)
- ✅ **Table** — flush-content table view with settings
- ❌ **StatChart** — selectable in the chart-type picker but has **no renderer** (falls back to a kind-name placeholder)

## Time range

- ✅ Global time-range picker (URL search params) drives all panel queries; chart zoom writes back to the URL
- ❌ Per-dashboard `duration` / auto-`refreshInterval` (schema-only, see above)

## Testing

- ✅ Unit tests: tree building/search/counts (`tree.test.ts`), grid layout conversion (`convert.test.ts`), server-fn behavior incl. `moveFolder` cycle check and insert-only/update-only split (`server.test.ts`)
- ✅ Full feature browser-verified end-to-end (folder CRUD, all management flows, delete modes, no-overwrite behavior)

## Known rough edges

- Duplicate folder name (same parent) surfaces the raw SQL unique-constraint error in the toast instead of a friendly message
- Tree/toolbar kebab buttons are icon-only without `aria-label`s
- Slug collision on create (astronomically unlikely at 36^12) has no retry — would surface as a raw DB error toast
- `renameDashboard` does a read-modify-write of the full spec; a concurrent full-spec save in the same window can be clobbered (accepted at current scale)
