# Unified telemetry filters — design

Date: 2026-06-03
Branch: `gio/ui-fixes`

## Problem

The filter sidebars on the Logs, Errors, and Traces pages have drifted apart.
They share the underlying primitives (`AttributeFilterSection`, `FilterCombobox`)
but differ in container styling, control ordering, free-text-search placement,
and clear-all behaviour. Common attributes such as `deployment.environment` are
only reachable through the generic attribute picker's "Suggested" section rather
than as first-class controls.

Goal: streamline the UX so the three bars feel like one system — without forcing
them to be identical (Logs keeps its Level selector, Traces keeps Status and
duration, etc.) — and promote `environment` to a dedicated top-level control on
every page.

## Current state

| | Logs | Errors | Traces |
|---|---|---|---|
| Container | bare `div`, no bg | `aside` + `bg-muted/15` | `aside` + `bg-muted/15` |
| Domain control | Level toggles | Order (sort) toggle | Status toggle |
| Service | combobox | combobox | combobox (+ Namespace) |
| Free-text | header bar (`q`) | header bar (`ErrorSearchForm`) | span-name input in sidebar |
| Attribute section | middle | before Order | before Clear |
| Clear-all | none | none | yes |
| Domain extras | Trace ID | — | Min/Max ms |

Relevant files (all in `packages/telemetry-explorer/src` unless noted):

- `logs/ui/log-filters.tsx` — `LogFiltersBar`
- `logs/ui/logs-explorer.tsx` — owns the header search bar + grid layout
- `errors/ui/error-filters.tsx` — `ErrorFilters` + `ErrorSearchForm`
- `errors/ui/error-issues.tsx` — owns the header search bar + grid layout
- `traces/ui/trace-filters.tsx` — `TraceFilters` (incl. `NameInput`, `DurationInput`)
- `traces/ui/traces-search-page.tsx` — grid layout, **no** header bar today
- `attribute-filter/ui/*` — shared attribute filter UI (unchanged in shape)
- `*/ui/*-attribute-config.ts` — per-domain promoted/excluded/sources config

The desktop-app pages (`packages/desktop-app/src/features/{logs,errors,traces}/*-page.tsx`)
import the explorer wrappers (`LogsExplorer`, `ErrorIssues`, `TracesSearch`) and
own the top header with the time-range/refresh pickers. They do not import the
filter-bar components directly. **Verify this during implementation** before
relying on it — changing shared `telemetry-explorer` exports can break
`@everr/desktop-app`, which has no `typecheck` script (use
`cd packages/desktop-app && pnpm exec tsc --noEmit`).

## Decisions (from brainstorming)

1. **Promotion model:** curated *fixed* controls — promoted attributes always
   render as dedicated controls regardless of whether they appear in the current
   data.
2. **Which attributes:** only `deployment.environment` ("Environment") is
   elevated to a dedicated control, on all three pages. Everything else
   (Repository, Host, Route, DB system, …) stays in the picker's Suggested
   section, unchanged.
3. **Standardize:** shared container + canonical section order; clear-all on
   every page; attribute section always last; one consistent home for free-text
   search.
4. **Free-text home:** the header bar above the sidebar+results grid (the
   existing Logs/Errors pattern). Traces' span-name input moves up into a header
   bar to match.

## Design

### 1. Shared sidebar shell — `FilterSidebar`

New component at `packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx`.

Responsibilities:

- Render the container: `<aside aria-label={…}>` with
  `bg-muted/15 flex h-full min-h-0 flex-col gap-3 overflow-auto border-b p-3 lg:border-r lg:border-b-0`
  (the styling Errors/Traces already use; Logs adopts it, replacing its bare
  `div` and the `aside` currently wrapping `LogFiltersBar` in `logs-explorer.tsx`).
- Render the header row: `ListFilter` icon + "Filter" label on the left, and a
  **Clear all** link on the right shown only when `hasActiveFilters` is true.
- Children are the page's controls, composed in canonical order.

Props:

```ts
interface FilterSidebarProps {
  label: string;            // aria-label, e.g. "Log filters"
  hasActiveFilters: boolean;
  onClear: () => void;      // page-specific reset to defaults
  children: React.ReactNode;
}
```

The Clear-all link reuses the Traces styling
(`text-muted-foreground hover:text-foreground text-xs underline`) but lives in
the header row (right-aligned) rather than at the bottom, so it is consistent
and discoverable across pages.

### 2. Canonical control order

Within `FilterSidebar` children, every page follows:

```
1. Domain toggle    — Logs: Level · Errors: Order(sort) · Traces: Status
2. Service          — Traces renders Namespace immediately above Service
3. Environment      — NEW dedicated control (section 3)
4. Domain inputs    — Logs: Trace ID · Traces: Min/Max ms · Errors: none
5. Attribute filters — AttributeFilterSection, always the final group
```

`<Separator />` between groups, matching current usage. Errors' "Order" toggle
keeps the domain-toggle slot for layout symmetry even though it is a sort, not a
filter; it is **excluded** from the `hasActiveFilters` calculation and from the
clear-all reset.

### 3. Environment dedicated control — `AttributeValueCombobox`

New component at `packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.tsx`.

It is UI sugar over the existing `attributes` array (chosen approach **A**; no
schema/query/backend changes). Environment is the resource attribute
`deployment.environment`, which the attribute-filter query path already handles
(it is a "suggested" attribute today).

Behaviour:

- Given `repo`, `domain`, `timeRange`, `source` (`"resource"`), `key`
  (`"deployment.environment"`), `label` (`"Environment"`), and the current
  `attributes` array, it finds the single attribute entry matching
  `source`+`key`+`op:"in"` and surfaces its `values` through a `FilterCombobox`.
- Selecting values writes back a single
  `{ source, key, op: "in", values }` entry into the `attributes` array
  (replacing any existing entry for that key); clearing all values removes the
  entry. It returns the updated `attributes` array via `onChange`.
- Option values are fetched with the repo's existing `attributeValues` for that
  key/source/timeRange (the same call the attribute picker uses).

Wiring per page:

- Add `resource:deployment.environment` to each page's `*_EXCLUDED_KEYS` so the
  generic picker no longer offers it (it now has a dedicated control).
- Remove `deployment.environment` from each page's `*_PROMOTED_ATTRIBUTES`
  Suggested list (it is promoted to a real control instead). Repository/Host/etc.
  remain.
- Render `<AttributeValueCombobox … />` in the Environment slot.

Only Environment uses this component now; it is parameterized so additional
curated attributes could be promoted later without new code, but we add no
others (YAGNI).

Edge case: if an `op` other than `in` (e.g. `not_in`/`missing`) ever existed for
`deployment.environment`, the dedicated control only manages the `in` entry. We
exclude the key from the picker, so no new non-`in` entries can be created; any
legacy non-`in` entry in a bookmarked URL is left untouched by the control and
still applies. This is acceptable.

### 4. Free-text search → header bar on all pages

- Logs (`logs-explorer.tsx`) and Errors (`error-issues.tsx`) already render the
  search row as `<div className="border-b bg-muted/10 px-3 py-2">…</div>` above
  the grid. Keep as-is; optionally extract a tiny shared `FilterSearchBar`
  wrapper for the row chrome (the inner form/inputs stay page-specific because
  the value semantics differ: log body vs error message vs span name).
- Traces (`traces-search-page.tsx`): add the same header-bar row above the grid
  and move the span-name search into it. The existing `NameInput` commit
  behaviour (Enter to apply, Escape to revert, apply-affordance icon) is
  preserved; it is relocated, not rewritten. The `name` value stays in the
  traces search params unchanged.

### 5. Out of scope

- No changes to query builders, SQL, Zod search schemas, or URL param shapes.
- Service filter stays inline per page (already on `FilterCombobox`); only its
  position is standardized — not extracted.
- Time-range/refresh pickers stay in the desktop-app header; untouched.
- No new attributes promoted beyond Environment.

## Files touched

New:
- `packages/telemetry-explorer/src/filters/ui/filter-sidebar.tsx`
- `packages/telemetry-explorer/src/filters/ui/attribute-value-combobox.tsx`
- (optional) `packages/telemetry-explorer/src/filters/ui/filter-search-bar.tsx`

Modified:
- `logs/ui/log-filters.tsx` — use `FilterSidebar`, add Environment control,
  reorder, add clear-all wiring.
- `logs/ui/logs-explorer.tsx` — adopt shared search-row chrome if extracted;
  the `aside` wrapper styling moves into `FilterSidebar`.
- `errors/ui/error-filters.tsx` — use `FilterSidebar`, add Environment, reorder,
  clear-all (excluding sort).
- `errors/ui/error-issues.tsx` — search-row chrome if extracted.
- `traces/ui/trace-filters.tsx` — use `FilterSidebar`, add Environment, move
  span-name out, keep duration/status, move clear-all into header row.
- `traces/ui/traces-search-page.tsx` — add header search bar, relocate span-name.
- `logs/ui/log-attribute-config.ts`, `errors/ui/error-attribute-config.ts`,
  `traces/ui/trace-attribute-config.ts` — update excluded/promoted lists for
  Environment.

## Verification

- `pnpm --filter @everr/telemetry-explorer typecheck` (or repo equivalent).
- `cd packages/desktop-app && pnpm exec tsc --noEmit` (desktop-app has no
  typecheck script).
- Manual: on each page confirm the canonical order, the Environment combobox
  populates from real data and filters results, clear-all resets correctly
  (and does not reset Errors' sort), and Traces span-name search works from the
  new header bar.
