# Dashboard Variables — Design

_Date: 2026-06-06. Branch: `gio/dashboard-variables` (off `gio/perses-dashboard-route`)._

Adds Perses-style dashboard variables: reusable dashboards where panel SQL references `$service`-style tokens and viewers pick values from a variable bar. Full v1 scope: TextVariable, ListVariable with static and ClickHouse-query-backed options, multi-select, and "All".

**This spec is written for handoff to a fresh implementer with no session context — the "Context for implementers" section at the end is required reading before planning.**

## Decisions already made (do not re-litigate)

1. **Scope:** TextVariable + ListVariable with `StaticListVariable` and `ClickHouseSQLVariable` option plugins; `allowMultiple` and `allowAllValue` supported in v1.
2. **Interpolation:** Grafana-style tokens, server-side substitution. Values become escaped SQL literals; `${name:raw}` is the unescaped escape hatch.
3. **Definition UI:** edit-mode "Variables" manager, mutations dirty-tracked through the dashboard store (same flow as panel edits — blocker + Save).
4. **Value state:** a single `vars` URL search param holding a JSON object. Chosen over Grafana-style `var-<name>` params for v1 because dynamic keys fight TanStack Router's static zod `validateSearch` (unknown keys are stripped on in-app navigation) and the retain/strip middlewares. **TODO (tracked follow-up, not v1):** layer on Grafana/Perses-style `var-<name>` URL aliases later — accept them at parse time and translate into `vars` so externally-templated links work; existing `vars` links must keep working.

## 1. Data model

`packages/app/src/data/dashboards/schema.ts` already defines (do not redefine): `textVariable` (`spec.name`, `spec.value`, `spec.display`, `spec.constant`), `listVariable` (`spec.name`, `spec.display`, `spec.defaultValue: string | string[]`, `allowAllValue`, `allowMultiple`, `customAllValue`, `capturingRegexp`, `sort`, `spec.plugin`), and `variable` (discriminated union) inside `dashboardSpecSchema.variables?: variable[]`.

New — the two list plugin kinds (typed helpers over the existing loose `plugin: { kind, spec }`):

- `StaticListVariable` — `spec.values: string[]` (Perses-native kind name).
- `ClickHouseSQLVariable` — `spec.query: string` (ours). Options are the **first column** of the result, stringified, deduplicated, in query order. The query runs through the same org-scoped ClickHouse context as panels and may use `{from:...}`/`{to:...}` params (the server always supplies the current time range). Other variables are **not** interpolated into option queries in v1 (no chaining).

Parsed-but-ignored in v1: `capturingRegexp`, `sort` (keep schema compat; document in the variables manager UI as unsupported).

Variable **names** must match `[a-zA-Z_][a-zA-Z0-9_]*` and be unique per dashboard (manager enforces; interpolation treats names case-sensitively).

## 2. Interpolation module

New pure module `packages/app/src/data/dashboards/interpolate.ts` (fully unit-tested, used only server-side but kept importable for tests):

- **Token syntax:** `$name`, `${name}`, `${name:raw}`. `$name` ends at the first character not in `[a-zA-Z0-9_]` (so `$service_suffix` is the variable `service_suffix`; use `${service}_suffix` to delimit).
- **Resolution input:** `Record<string, string | string[]>` of effective values, plus per-variable metadata needed for All (`customAllValue`, loaded options).
- **Substitution rules:**
  - single string value → escaped SQL literal: `'api'` (escape `\` and `'` by ClickHouse rules: backslash-escaping).
  - array value (multi-select) → parenthesized list: `('api','web')`. Empty array → `('')` is wrong — substitute `(NULL)` so `IN (NULL)` matches nothing deterministically.
  - All sentinel (see §4): if `customAllValue` is set → substitute it **raw**; else expand to the full loaded options list as a parenthesized escaped list.
  - `${name:raw}` → value substituted verbatim, unescaped (arrays joined with `,`). Trust model: acceptable because the CH context is org-scoped and panel SQL is already arbitrary user-authored SQL; document that raw values are URL-injectable by anyone the link is shared with.
  - Unknown `$name` (no such variable) → token left untouched (it may be ClickHouse syntax).
- Export `extractVariableTokens(sql)` for the UI to know which variables a panel references (used by the editor to hint, optional nicety — drop if it grows).

## 3. Server functions

`packages/app/src/data/dashboards/server.ts`:

- `runPanelQuery` input gains optional `variables: z.record(z.string(), z.union([z.string(), z.array(z.string())]))` **and** optional `variableMeta` (per-name `{ customAllValue?, options? }` — only what interpolation needs for All). Handler interpolates via the module before `context.clickhouse.query`. `from`/`to` behavior unchanged.
- New `runVariableOptionsQuery` server fn: input `{ query: string, from?, to? }`; runs the query org-scoped, returns `{ options: string[] }` = stringified first-column values, deduped, capped at 1000 (log/truncate silently is NOT ok — return a `truncated: boolean` flag so the picker can show "first 1000 shown").

Note on `variableMeta`: an alternative is to have the server load the dashboard spec and options itself — rejected for v1 because panel queries in the editor run against *unsaved* drafts; the client already holds effective values + options.

## 4. Value state — URL param, no seeding

- New search param on the dashboard layout schema (`packages/app/src/routes/_authenticated/_dashboard.tsx` → `DashboardSearchSchema`): `vars: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional()`. TanStack Router's default search serializer handles the JSON object encoding.
- **All sentinel:** the string `"__all"` as the *sole* value (`vars={"env":"__all"}`).
- **Effective value resolution** (pure helper + tests, e.g. `data/dashboards/variable-values.ts`): `effective(name) = vars[name] ?? specDefault(name)` where specDefault is `TextVariable.spec.value` or `ListVariable.spec.defaultValue` (normalize: multi-select variables always resolve to arrays; single-select to strings; All allowed only when `allowAllValue`). Invalid URL values (e.g. array for a single-select) fall back to the default.
- Pickers navigate with `search: prev => ({ ...prev, vars: nextVars })`, `replace: false` (back button steps through selections). Do **not** add `vars` to the layout's `retainSearchParams` — values should drop when leaving the dashboard (different dashboards have different variables).
- No URL seeding/rewriting on load (unlike `duration`): the variable bar is the only UI showing these values, so there is no header-picker consistency problem. Defaults apply silently when the param is absent.

## 5. Variable bar

New `packages/app/src/components/dashboards/variable-bar.tsx`, rendered on the dashboard page (between toolbar and grid, only when the dashboard has visible variables) and in the panel editor (compact, in/under the header) so previews use real values.

Per variable (skip when `display.hidden`):
- **Text** → labeled `Input`, commits on Enter/blur.
- **List single-select** → dropdown (follow the `OptionSelect` pattern from `dashboard-settings-dialog.tsx`).
- **List multi-select** → dropdown with checkbox items + "All" entry when `allowAllValue` (selecting All clears individual selections and vice versa).
- Query-backed options load via react-query: `variableOptionsQueryOptions(query, from, to)` keyed on query + time range, so options refresh when the time range changes. Loading → disabled picker with spinner; error → picker shows an inline error state with the message (tooltip), not a toast.
- Label = `display.name ?? name`.

## 6. Panel query wiring

- `panelQueryOptions` (`data/dashboards/options.ts`) gains `variables`/`variableMeta` args — they join the queryKey so changing a value refetches like a time-range change.
- `dashboard-panel.tsx` and `panel-edit-page.tsx` compute effective values via the §4 helper (from `useSearch` + the store dashboard's `spec.variables`) and pass them through. The editor's manual Run Query passes them too.
- Panels whose SQL contains a token for a variable with **no effective value** (no URL value, no default, empty text) render the existing error card with message "Select a value for $name" — implemented client-side (skip the query via `enabled: false`), not as a CH error.

## 7. Variables manager (edit mode)

New `packages/app/src/components/dashboards/variables-manager.tsx`: a dialog opened from a "Variables" button rendered next to "Add Panel" in `dashboard-grid.tsx` (edit mode only).

- List view: rows of name, kind (Text / Static list / Query list), flags (multi, all, hidden), edit + delete buttons (aria-labels per the conventions below).
- Add/edit form: kind selector, then per-kind fields — Text: name, label, value, constant, hidden; List: name, label, default, allowMultiple, allowAllValue, customAllValue, hidden, plugin (Static → textarea of values one-per-line; ClickHouseSQL → SQL textarea + "Preview options" button hitting `runVariableOptionsQuery` and listing results inline).
- Validation: name regex + uniqueness; non-empty static values; non-empty query.
- All mutations go through a new store action `updateVariables(variables: Variable[])` in `dashboard-store.ts` that sets `isDirty: true` (mirrors `updateLayout`). Saving uses the existing Save flow — no new server fn for definitions.

## 8. Out of scope (v1) — document, don't build

- Variable chaining (variables inside option queries), `capturingRegexp`, `sort`.
- Grafana-style `var-<name>` URL params (tracked TODO, see Decisions §4).
- Per-panel variable overrides; variable usage in panel titles/descriptions.

## 9. Testing

TDD for all pure logic, following the existing patterns:

- `interpolate.test.ts`: escaping (quotes, backslashes), `$x` vs `${x}` vs `${x:raw}`, token boundary (`$var_suffix`, `${var}_suffix`), arrays, empty array → `(NULL)`, All with/without `customAllValue`, unknown token untouched, adjacent tokens.
- `variable-values.test.ts`: URL-wins, defaults, multi/single normalization, All only when allowed, invalid-shape fallback.
- `dashboard-store.test.ts`: `updateVariables` marks dirty.
- `server.test.ts`: `runPanelQuery` interpolates before executing (assert the SQL passed to the CH mock); `runVariableOptionsQuery` first-column extraction, dedup, truncation flag.
- Final browser verification end-to-end (see implementer context below for the protocol): create variables of each kind, multi-select + All, URL round-trip + back button, picker-driven refetch, dirty tracking through the manager, missing-value panel state, options-query error state.

---

## Context for implementers (fresh-session handoff)

### Where you are

- Monorepo `everr-labs/everr`, pnpm workspaces. The app is `packages/app` (TanStack Start/Router + React 19 + react-query + zustand + zod v4 via `import * as z`; UI kit `@everr/ui`). Postgres via Drizzle (dashboard specs live in a jsonb column — **never generate Drizzle migrations**; see repo `CLAUDE.md`). ClickHouse queried through `context.clickhouse.query(sql, { from, to })` in server fns, org-scoped by row-level policy — never add `tenant_id` filters manually.
- The dashboards feature is fully described in `DASHBOARD_FEATURES.md` (repo root). Read it. The prior iteration's spec/plan show the established working style: `docs/superpowers/specs/2026-06-05-dashboard-v1-polish-design.md`, `docs/superpowers/plans/2026-06-05-dashboard-v1-polish.md`.

### Key files (all under `packages/app/src` unless noted)

| File | Role |
|---|---|
| `data/dashboards/schema.ts` | zod schemas — `variable` union already exists |
| `data/dashboards/server.ts` | server fns (`runPanelQuery` at the bottom); `createAuthenticatedServerFn` pattern |
| `data/dashboards/options.ts` | react-query options + mutation hooks (toast on error pattern) |
| `data/dashboards/dashboard-store.ts` | zustand store — **contract:** `setDashboard` (load, clears dirty), `patchDashboard` (local edit, marks dirty), `updatePanel`/`updateLayout` (mark dirty), `updateDisplayName` (preserves dirty), `markSaved`, `reset`. `updateVariables` must follow `updateLayout`'s shape |
| `data/dashboards/time-defaults.ts` | example of a pure URL-param helper + its test style |
| `components/dashboards/dashboard-grid.tsx` | toolbar (Add Panel/Save/Edit/kebab), `useBlocker` unsaved-changes dialog — variables manager button mounts here |
| `components/dashboards/panel-edit-page.tsx` | full-page editor; second `useBlocker`; manual Run Query path |
| `components/dashboards/dashboard-panel.tsx` | grid panel query execution + error states |
| `components/dashboards/dashboard-settings-dialog.tsx` | `OptionSelect` dropdown-as-select pattern to reuse |
| `routes/_authenticated/_dashboard.tsx` | layout: `DashboardSearchSchema`, `stripSearchParams`/`retainSearchParams` middlewares |
| `routes/_authenticated/_dashboard/dashboards/$dashboardId.tsx` | dashboard route; duration/refresh seeding effect (do not disturb) |

### Repo conventions (non-negotiable)

- Never leave any trace of Claude/AI in commits, PRs, or comments. Conventional-commit messages, no co-author lines.
- Never use `tsx`. Use `everr-dev` (fall back to `everr`) for the everr CLI.
- Tests: `cd packages/app && pnpm exec vitest run <path>`; typecheck: `pnpm typecheck` (in `packages/app`). Full suite is currently 504 passing.
- lefthook pre-commit runs biome + `fallow` (unused-export linter). If you add an export consumed only by a later task, add a narrow suppression in `.fallowrc.jsonc` with a comment, and **remove it in the task that consumes the export**.
- `server.test.ts` mocks the db with chainable builders (`selectImpl`/`updateImpl`/`insertImpl`) — extend, don't replace. There is no CH mock yet for `context.clickhouse` — check how `runPanelQuery` is (not) tested and mock `context` accordingly if needed.

### Browser verification protocol

Dev server runs on `:5173` (reuse it — a second instance fails auth with "Invalid origin"). Drive with `playwright-core` installed in a tmp dir + the cached headless shell at `~/Library/Caches/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-mac-arm64/chrome-headless-shell`. Use `waitUntil: "load"` (never `networkidle` — HMR keeps the network busy). Create a throwaway account via `/auth/sign-up` (no email verification; complete the org "Continue" step), save Playwright `storageState`, reuse across scripts. Do not query the dev Postgres `user` table (PII; blocked). UI gotchas: shadcn Switch ids sit on a hidden checkbox — click `label[for=...]`; grid panel query errors appear only after react-query exhausts retries — wait for `text=Failed to load data` rather than screenshotting early. ClickHouse `numbers()` is handy for synthetic time series: `SELECT now() - INTERVAL number MINUTE AS time, number AS value FROM numbers(30)`.

### Process expectation

Brainstorm/design is done (this document). Next step: superpowers:writing-plans to produce `docs/superpowers/plans/2026-06-06-dashboard-variables.md` (bite-sized TDD tasks with complete code, exact paths, exact commands), then superpowers:subagent-driven-development to execute with per-task spec + quality reviews, then full-suite + browser verification, then update `DASHBOARD_FEATURES.md`.
