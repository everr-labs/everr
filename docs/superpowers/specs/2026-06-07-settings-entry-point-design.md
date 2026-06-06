# Single Settings Entry Point — Design

_Date: 2026-06-07. Branch: `gio/perses-dashboard-route` (follows up the settings-page feature; see `2026-06-06-dashboard-settings-page-design.md`)._

The settings page currently has two entry points: the edit-toolbar "Variables" button (deep-links `?section=variables`) and the kebab "Settings" item (saved dashboards only). This feels dispersive. Consolidate to ONE always-visible toolbar Settings button; section navigation becomes internal-only.

## Decisions already made (do not re-litigate)

1. **Medium consolidation:** one toolbar Settings button replaces both the Variables button and the kebab Settings item. The kebab shrinks to manage-only (Rename / Move to folder / Delete). Rename/Move/Delete do NOT move into the settings page (the list page's row kebabs already cover quick management).
2. **No section deep-linking:** the `section` search param and all its plumbing are removed. The settings page always opens on General; users reach Variables via the page's own sections nav.

## 1. Toolbar — `components/dashboards/dashboard-grid.tsx`

- **New Settings button:** `variant="outline" size="sm"`, `Settings2` icon, label "Settings", placed immediately LEFT of the Edit button, rendered ALWAYS (view + edit mode, saved + new dashboards). `onClick` navigates to `/dashboards/$dashboardId/settings` with `dashboardId: isNew ? "new" : dashboard.metadata.name`, search updater forwarding `vars` only (`(prev) => ({ ...prev, vars: prev.vars })`) — no `section`.
- **Variables button removed** from the edit-mode toolbar group (the group keeps Add Panel + Save). `SlidersHorizontal` import removed.
- **Kebab Settings item removed** (with its navigate). `Settings2` import stays (now used by the toolbar button). Kebab keeps Rename / Move to folder / separator / Delete, and still renders only when `!isNew` — acceptable, the toolbar button covers `new`.

## 2. Section-param removal

- **Route** (`routes/.../$dashboardId_/settings.tsx`): delete `SettingsSearchSchema` and the `validateSearch` option (the route then inherits the `_dashboard` layout's search schema untouched); delete `Route.useSearch()` and the `initialSection` prop pass.
- **Page** (`components/dashboards/dashboard-settings-page.tsx`): delete the `initialSection` prop; simplify the seed effect to `setSelection({ kind: "general" })` once the dashboard is available (keep the effect — selection still must wait for the dashboard); revert `keepVars` to the plain shape `(prev: { vars?: Record<string, string | string[]> }) => ({ ...prev, vars: prev.vars })` (no `section` strip — the param no longer exists).
- `routeTree.gen.ts` regenerates via the vite plugin (search-type change only).

## 3. Out of scope

- Moving Rename/Move/Delete into the settings page.
- Any change to settings-page internals (sections nav, variable form, Save), blocker semantics, or the list page.

## 4. Testing

- No existing test references `section`/`initialSection` (verified by grep). Suite stays 559; typecheck + desktop-app guard.
- Browser verification (existing protocol; dev server :5173, playwright-core env at /tmp/settings-verify with saved auth state + dashboard `xfmezad9iug4`): Settings button visible and working from view mode, edit mode, and `/dashboards/new`; kebab shows only Rename/Move/Delete; Variables reachable via the page's internal nav; `vars` round-trips through entry/exit; back arrow returns without stray params.

## Context for implementers

- Key files: `dashboard-grid.tsx` (toolbar at ~lines 310–350, kebab at ~lines 357–405), `dashboard-settings-page.tsx` (props ~25–35, seed effect ~75–86, keepVars ~110–118), `routes/.../settings.tsx`.
- Conventions: conventional commits, no AI traces, never `tsx`, lefthook biome + fallow pre-commit, never hand-edit `routeTree.gen.ts`. Tests: `cd packages/app && pnpm exec vitest run`; typecheck `pnpm typecheck`; desktop guard `cd packages/desktop-app && pnpm exec tsc --noEmit`.
