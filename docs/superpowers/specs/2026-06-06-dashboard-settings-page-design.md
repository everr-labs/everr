# Dashboard Settings Page — Design

_Date: 2026-06-06. Branch: `gio/dashboard-variables` (continues the dashboard-variables work; see `2026-06-06-dashboard-variables-design.md`)._

Replaces two dialogs with one full-page settings experience: the variables manager modal (cramped for editing, especially SQL) and the settings dialog (duration/refresh). Also extracts the panel editor's CodeMirror ClickHouse editor into a shared component so variable option queries get real SQL editing.

**Written for handoff to a fresh implementer — read "Context for implementers" at the end before planning.**

## Decisions already made (do not re-litigate)

1. **Page, not dialogs:** new route `/dashboards/$dashboardId/settings` with a sections nav (General | Variables); the Variables section contains its own nested list + detail form (three columns total). Both `variables-manager.tsx` and `dashboard-settings-dialog.tsx` are deleted.
2. **Unified save model:** everything on the page edits the in-store dashboard spec and marks it dirty; persisting goes through the existing dashboard Save flow. The `updateDashboardSettings` server fn, its `useUpdateDashboardSettings` hook, and its server tests are removed. `dashboardSpecSchema` is unchanged (duration/refreshInterval stay in the spec), so the URL-seeding effect in `$dashboardId.tsx` keeps working untouched.
3. **Commit granularity:** General's two dropdowns patch the store immediately on change (atomic values, no Apply). Variable forms are draft-based with an **Apply** button (validation on Apply, exactly today's rules); switching selection with un-applied edits prompts a confirm-discard dialog.
4. **Shared SQL editor:** extract the CodeMirror setup from `query-editor.tsx` into `SqlEditor`; both the panel `QueryEditor` and the variable form use it.

## 1. Route

New file route `packages/app/src/routes/_authenticated/_dashboard/dashboards/$dashboardId_/settings.tsx` → path `/dashboards/$dashboardId/settings`, mirroring the panel editor route exactly: `staticData: { breadcrumb: "Settings" }`, head title `Everr - Dashboard Settings`, loader prefetches `dashboardOptions(dashboardId)` unless `dashboardId === "new"`, component renders `<DashboardSettingsPage dashboardId={...} />`.

`dashboardId === "new"` works like the panel editor: the page reads the store-resident draft dashboard (no fetch). The settings page does NOT render the variable bar.

## 2. Page component — `components/dashboards/dashboard-settings-page.tsx`

Responsibilities (and nothing else): store bootstrap, header, blocker, section/selection state, confirm-discard dialog.

- **Store bootstrap:** same as `panel-edit-page.tsx` — `storeDashboard ?? fetchedDashboard`, effect calls `setDashboard(fetchedDashboard)` when the store is empty; render null until a dashboard exists.
- **Header:** back arrow `Link` to the dashboard (forwarding `vars` via the `keepVars` pattern), title `Settings — {display name ?? slug}`, and a **Save** button on the right using the existing `useSaveDashboard` mutation + `markSaved` (create flow for `new` is NOT supported here — the Save button is hidden when `isNew`; new-dashboard edits are persisted from the dashboard page's own Save, same as panel edits).
- **Sections nav (left column):** "General" and "Variables" entries. Selection state is local:
  `type Selection = { kind: "general" } | { kind: "variable"; index: number } | { kind: "new-variable" }`.
  Initial value comes from a new optional search param on this route only (`validateSearch` on the settings route): `section: z.enum(["general", "variables"]).optional().catch(undefined)` — `"variables"` selects `{ kind: "variable", index: 0 }` when variables exist, else `{ kind: "new-variable" }`; default is General.
- **Middle column** appears only for the Variables section (rendered by `settings-variables-section.tsx`, below).
- **Dirty-form guard:** the page owns a `confirmPending` state; when the variable form reports un-applied edits and the user changes selection (or section), show an AlertDialog ("Discard changes to this variable?" Stay / Discard) before switching.
- **Blocker:** `useBlocker` identical in shape to the panel editor's: block when `isDirty` and `!next.pathname.startsWith(dashboardPrefix)` where `dashboardPrefix = /dashboards/${dashboardId}`; same Stay / Discard & leave dialog (`resetStore` on proceed); `enableBeforeUnload` on dirty. The blocker does NOT consider un-applied form drafts (only store dirty) — the confirm-discard dialog covers drafts within the page, and leaving the page entirely with an un-applied draft is an accepted loss (drafts are not store state).

## 3. General section — `components/dashboards/settings-general-section.tsx`

- The `OptionSelect` helper and `DURATION_OPTIONS` list move here verbatim from the deleted `dashboard-settings-dialog.tsx` (refresh options keep coming from `REFRESH_INTERVALS`).
- Two labeled selects: "Default time range" and "Auto-refresh". Each select's `onChange` immediately patches its own field in the store (no new store action): `patchDashboard({ ...dashboard, spec: { ...spec, duration: value || undefined } })` and likewise for `refreshInterval` — empty selection deletes the field, matching the old dialog/server-fn semantics.
- Short caption matching the old dialog copy: defaults applied when the dashboard is opened without explicit URL params.

## 4. Variables section — `components/dashboards/settings-variables-section.tsx`

- **List (middle column):** one row per variable — name, kind label (Text / Static list / Query list), flag badges (multi, all, hidden) — plus a "+ Add variable" entry pinned at the bottom. Rows are buttons (aria-label `Edit variable <name>`); the selected row is highlighted. No per-row delete (Delete lives in the form).
- **Detail pane (right column):** the variable form. Draft-based:
  - Draft state initializes from the selected variable (`draftFromVariable`) or `emptyDraft()` for Add; reinitializes via `key={selectionKey}` remount on selection change.
  - Same fields as the modal: kind ToggleGroup, name, label, Text → value + constant; List → plugin ToggleGroup (Static → one-per-line Textarea; ClickHouseSQL → **`SqlEditor`** + "Preview options" button → `runVariableOptionsQuery` with `from`/`to` from search, inline options list/truncation note/error — no toast), default value, allowMultiple, allowAllValue (+ customAllValue when on), hidden.
  - **Apply** validates (`validateDraft`: name regex + uniqueness excluding self + non-empty static values/query) and commits via `updateVariables` (append for new, replace by index for edit), then keeps the variable selected. Inline error text on failure; errors clear on any field change.
  - **Delete** button (edit mode only) commits via `updateVariables(filter)` and moves selection to the previous row (or General when none left). No confirmation (consistent with panel removal; dashboard Save is the persistence gate).
  - The form reports `hasUnappliedChanges` upward (draft ≠ initial draft, JSON compare) for the page's confirm-discard guard.
- The "capturingRegexp/sort parsed but not applied in v1" note moves from the dialog description to a muted caption in the form.

## 5. Shared SQL editor — `components/dashboards/sql-editor.tsx`

Extract from `query-editor.tsx` everything CodeMirror: the `clickhouseDialect` definition, `basicSetup`/`oneDark`/theme/`placeholder` extensions, and the mount-once + `updateListener` + refs pattern. API:

```ts
interface SqlEditorProps {
  defaultValue: string;          // initial doc; parent remounts via key to reset
  onChange: (sql: string) => void;
  placeholder?: string;
  className?: string;            // sizing left to the parent
}
```

- `QueryEditor` becomes a thin wrapper: label + Run Query button + `<SqlEditor>` (its `getQueryText`/`setQueryText` Panel plumbing stays in `query-editor.tsx`). No behavior change in the panel editor.
- The variable form renders `<SqlEditor key={selectionKey} ... />` with a fixed height (~10rem) via className.

## 6. Navigation changes

- `dashboard-grid.tsx`:
  - Kebab "Settings" item: `setManageAction("settings")` → `navigate` to `/dashboards/$dashboardId/settings`. The `manageAction` `"settings"` variant and `<DashboardSettingsDialog>` render are removed.
  - Edit-toolbar "Variables" button: navigates to `/dashboards/$dashboardId/settings?section=variables` (or `/dashboards/new/settings?section=variables` when `isNew`) instead of opening the modal; `showVariablesManager` state and `<VariablesManager>` render are removed.
  - Both navigations forward `vars` (`search: (prev) => ({ ...prev, vars: prev.vars, section: ... })`).
  - Blocker exemption broadens: `!next.pathname.startsWith(panelEditPrefix)` becomes `!next.pathname.startsWith(dashboardPathPrefix)` where `dashboardPathPrefix = /dashboards/${isNew ? "new" : slug}` — covers the panel editor AND the settings page (the same-pathname exemption stays).
- Settings page exits (back arrow, blocker proceed) forward `vars` like the panel editor's `keepVars`.

## 7. Removals

- `components/dashboards/variables-manager.tsx` (form/draft helpers move out first, §8).
- `components/dashboards/dashboard-settings-dialog.tsx` (`OptionSelect`/`DURATION_OPTIONS` move to the General section).
- `updateDashboardSettings` server fn (`server.ts`), `updateDashboardSettingsInput` (`schema.ts`), `useUpdateDashboardSettings` (`options.ts`), the `describe("updateDashboardSettings")` block in `server.test.ts` (3 tests), and the `settingsMutation` wiring in `dashboard-grid.tsx`.

## 8. Pure module extraction — `data/dashboards/variable-draft.ts`

`VariableDraft`, `emptyDraft`, `draftFromVariable`, `variableFromDraft`, `validateDraft`, `parseStaticValues` move VERBATIM from `variables-manager.tsx` into this module and gain unit tests (`variable-draft.test.ts`): round-trips for text (value/constant/hidden/label), static list (values, defaults single + multi), query list (query, customAllValue), kind-label derivation if moved too, validation matrix (bad name, duplicate, duplicate-excluding-self, empty static values, empty query, valid cases). The settings variables section imports from here.

## 9. Out of scope

- A "create dashboard" Save flow on the settings page (`new` edits save from the dashboard page).
- Migrating Rename/Move/Delete into the settings page (kebab keeps them).
- Variable reordering, search/filter in the list, per-variable URL deep links.
- Any change to interpolation, value resolution, the variable bar, or panel wiring.

## 10. Testing

- `variable-draft.test.ts` — the extracted helpers (new coverage; they were untested inside the modal).
- `server.test.ts` — remove the 3 `updateDashboardSettings` tests; everything else stays green.
- Full suite + typecheck (app + desktop-app guard) + fallow.
- Browser verification (same protocol as the variables feature; dev server on :5173, see implementer context): kebab Settings → page; Variables button → page with Variables section selected; General duration change marks dirty + Save persists + seeding still works on next visit; variable add/edit/delete with Apply; un-applied-edit confirm on selection switch; SQL editor typing + Preview options; blocker on leaving with dirty store; `vars` preserved across page entry/exit; `new` dashboard flow (Variables button from /dashboards/new).

---

## Context for implementers (fresh-session handoff)

### Where you are

- Monorepo `everr-labs/everr`, pnpm workspaces; app is `packages/app` (TanStack Start/Router + React 19 + react-query + zustand + zod v4). Branch `gio/dashboard-variables` already contains the full dashboard-variables feature (spec: `docs/superpowers/specs/2026-06-06-dashboard-variables-design.md`, plan: `docs/superpowers/plans/2026-06-06-dashboard-variables.md`) — 19 commits, 548 tests passing. This design REPLACES that feature's modal UI; read both specs.
- `DASHBOARD_FEATURES.md` (repo root) describes the whole dashboards feature — update it at the end (variables manager → settings page).

### Key files

| File | Role |
|---|---|
| `components/dashboards/variables-manager.tsx` | the modal being replaced — contains the draft helpers to extract |
| `components/dashboards/dashboard-settings-dialog.tsx` | the dialog being replaced — contains `OptionSelect`/`DURATION_OPTIONS` |
| `components/dashboards/panel-edit-page.tsx` | the pattern to mirror: store bootstrap, blocker, `keepVars`, header |
| `components/dashboards/query-editor.tsx` | CodeMirror setup to extract into `SqlEditor` |
| `components/dashboards/dashboard-grid.tsx` | kebab + Variables button + blocker exemption to change |
| `routes/_authenticated/_dashboard/dashboards/$dashboardId_/panel/$panelKey.tsx` | route file pattern to copy for `settings.tsx` |
| `data/dashboards/dashboard-store.ts` | `patchDashboard`, `updateVariables`, `markSaved`, dirty contract |
| `data/dashboards/server.ts` / `options.ts` / `schema.ts` | removals (§7) |
| `data/dashboards/variable-values.ts` | `VARIABLE_NAME_RE`, `getListVariableSource` (used by draft helpers) |

### Repo conventions (non-negotiable)

- Never any Claude/AI trace in commits/PRs/comments. Conventional commits, no co-author lines.
- Never `tsx`. Tests: `cd packages/app && pnpm exec vitest run <path>`; typecheck `pnpm typecheck`; desktop-app guard `cd packages/desktop-app && pnpm exec tsc --noEmit`.
- lefthook pre-commit: biome (may rewrite — re-stage) + `fallow dead-code` (test files count as consumers; order work so every new export has a consumer in its commit; deletions must not orphan exports).
- Routes: file-based; `$dashboardId_` directory creates the un-nested `/dashboards/$dashboardId/...` paths.

### Browser verification protocol

Dev server runs on `:5173` (reuse it — a second instance fails auth with "Invalid origin"). Drive with `playwright-core` in a tmp dir + cached headless shell at `~/Library/Caches/ms-playwright/chromium_headless_shell-1223/...`. `waitUntil: "load"`, never `networkidle`. Throwaway account via `/auth/sign-up` (+ org "Continue"), save/reuse `storageState`. Don't query dev Postgres `user` table. Switch ids sit on hidden checkboxes — click `label[for=...]`. Panel errors appear after react-query retries — wait for "Failed to load data". CodeMirror: click `.cm-content`, then type.

### Process expectation

This document is the approved design. Next: superpowers:writing-plans → `docs/superpowers/plans/2026-06-06-dashboard-settings-page.md`, then superpowers:subagent-driven-development with per-task spec + quality reviews, full suite + browser verification, `DASHBOARD_FEATURES.md` update.
