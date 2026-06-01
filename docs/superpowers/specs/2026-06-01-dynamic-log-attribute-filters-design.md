# Dynamic Log Attribute Filters — Design

**Date:** 2026-06-01
**Status:** Approved, ready for implementation plan
**Area:** `packages/telemetry-explorer` (logs search UI) + `packages/app` logs route

## Problem

The logs search UI offers a fixed set of filters: Level, Service (`ServiceName` column),
Source (`ResourceAttributes['vcs.repository.name']`), and Trace (`TraceId`). Each is
hardcoded to one column or one resource-attribute key. Users cannot filter on any other
attribute the logs actually carry (e.g. `deployment.environment`, `k8s.pod.name`, a
custom log-record field), even though those attributes are present in the data.

We want a **dynamic filter UI**: discover the attributes present in the logs within the
currently viewed time range, and let users build filters on any of them.

## Scope

- **Attribute sources:** all three OTel attribute maps — `ResourceAttributes` (`resource`),
  `LogAttributes` (`log`), and `ScopeAttributes` (`scope`). Fixed columns (`ServiceName`,
  `SeverityText`, `TraceId`) are **not** folded in; the existing Service/Level/Trace filters
  stay as they are.
- **Value selection:** key-then-value-list. The user picks an attribute key, then we query
  the distinct values for that key in the current time range and present them as a checklist.
- **Match semantics per filter:** `in` (any-of), `not_in`, `exists` (key present), `missing`
  (key absent). Multiple attribute filters AND together.
- **Coexistence:** Service/Level/Trace stay pinned. A few high-value resource attributes
  (Repository, Environment, Host) are surfaced as promoted quick-pick chips. The dedicated
  Source filter is retired — Repository is now just a promoted attribute filter on
  `vcs.repository.name`.

### Non-goals

- Substring/`contains` matching on values (the discovered-value checklist can't back it cleanly).
- Faceted value counts (kept out to keep query load bounded; can be added later).
- A materialized attribute catalog (Approach C below) — reserved as an escape hatch.

## Approach

**Lazy, two-step discovery (Approach A).** One cheap query lists the attribute *keys* in the
time range; a per-key query fetches *values* only when the user opens that key. This mirrors
the existing react-query option pattern used by the current Service/Source comboboxes, keeps
each query bounded, and never does work for keys the user doesn't open.

Rejected alternatives:
- **B — Eager bulk discovery** (all keys + values in one query): wasteful, most keys are
  never expanded; expensive on wide attribute sets.
- **C — Materialized catalog** (background job): new infrastructure, staleness, overkill at
  current scale. Kept as a future option if key discovery becomes a bottleneck.

## Backend

### Filter shape (`logs/schemas.ts`)

Add to `LogsSearchFiltersShape` alongside `levels`/`services`:

```ts
const AttributeSourceSchema = z.enum(["resource", "log", "scope"]);
const AttributeOpSchema = z.enum(["in", "not_in", "exists", "missing"]);

export const AttributeFilterSchema = z.object({
  source: AttributeSourceSchema,           // which map
  key: z.string().min(1),                  // e.g. "deployment.environment"
  op: AttributeOpSchema,
  values: z.array(z.string()).default([]), // ignored for exists/missing
});

// in LogsSearchFiltersShape:
attributes: z.array(AttributeFilterSchema).default([]),
```

Because this lives in the shared `LogsFilterShape`, it automatically flows through the
explorer, totals, and histogram inputs.

The existing `repos` field is **removed** from `LogsSearchFiltersShape` (see Wiring).

### Source → column whitelist

A helper maps `source` to a fixed column name so the column is never user-controlled; only
`key` and `values` become bound query params:

- `resource` → `ResourceAttributes`
- `log` → `LogAttributes`
- `scope` → `ScopeAttributes`

Unknown source values are rejected.

### Key discovery (`logs/sql/attribute-keys.ts`, new)

One bounded query — distinct keys per map over the time range, tagged with source:

```sql
SELECT DISTINCT arrayJoin(mapKeys(ResourceAttributes)) AS key, 'resource' AS source
  FROM logs WHERE <timeRange>
UNION ALL
SELECT DISTINCT arrayJoin(mapKeys(LogAttributes)) AS key, 'log' AS source
  FROM logs WHERE <timeRange>
UNION ALL
SELECT DISTINCT arrayJoin(mapKeys(ScopeAttributes)) AS key, 'scope' AS source
  FROM logs WHERE <timeRange>
ORDER BY source, key LIMIT 500
```

**Guardrail:** the `LIMIT 500` cap is surfaced in the UI ("showing first 500 attributes")
rather than silently truncating. On very large/wide time ranges this query can get heavy;
Approach C is the escape hatch if it becomes a problem.

### Value discovery (`logs/sql/attribute-values.ts`, new)

Generalizes the current Source query. Column resolved from the whitelist; `key` bound as a param:

```sql
SELECT DISTINCT <col>[{key:String}] AS v
  FROM logs
 WHERE <timeRange>
   AND mapContains(<col>, {key:String})
   AND <col>[{key:String}] != ''
 ORDER BY v LIMIT 100
```

### WHERE builder (`logs/sql/where.ts`)

One clause per attribute filter, with indexed param names (`attrKey0`, `attrVals0`, …) so
many filters coexist:

- `in` → `mapContains(col, key) AND col[key] IN vals`
- `not_in` → `(NOT mapContains(col, key) OR col[key] NOT IN vals)` — logs missing the
  attribute count as "not X"
- `exists` → `mapContains(col, key)`
- `missing` → `NOT mapContains(col, key)`

Because these clauses carry dynamic params, **`buildWhereClause` changes to return
`{ clause, params }`** instead of a bare string. The three callers — `explorer.ts`,
`totals.ts`, `histogram.ts` — merge those params instead of hand-assembling
`services`/`repos`. This is the one refactor of existing code.

## UI (`logs/ui/`)

The filter sidebar keeps its current top half (Level, Service, Trace) and gains an
Attributes section below. The dedicated **Source** combobox is removed.

```
┌ Filter ───────────────────────────┐
│ ● error            1,204          │   levels (unchanged)
│ ● warning            312          │
│ ● info            45,991          │
│ ───────────────────────────────── │
│ Service           [All services▾] │   unchanged
│ Trace             [# Any trace  ] │   unchanged
│ ───────────────────────────────── │
│ Attributes                        │
│  Quick: [Repository][Environment] │   promoted chips
│         [Host]                    │
│                                   │
│  deployment.environment  is  ▾    │   active filter row
│    ☑ production  ☐ staging        │
│  k8s.pod.name        exists  ✕    │   exists row (no values)
│                                   │
│  [+ Add filter]                   │   opens key picker
└───────────────────────────────────┘
```

### New components

- **`attribute-filter-section.tsx`** — owns the promoted chips, the active-filter list, and
  the "Add filter" control. Receives `attributes` + `onChange` like the rest of the bar.
- **`attribute-key-picker.tsx`** — searchable popover listing discovered keys grouped by
  source (Resource / Log / Scope), backed by the key-discovery query. Selecting a key appends
  a new filter with default op `in`.
- **`attribute-filter-row.tsx`** — one active filter: key label, op `Select`
  (In / Not in / Exists / Missing), a value `FilterCombobox` (reusing the existing component,
  backed by the value-discovery query), and a remove button. When op is `exists`/`missing`,
  the value picker is hidden.

### Promoted chips

A small static constant, easy to extend:

```ts
const PROMOTED_ATTRIBUTES = [
  { source: "resource", key: "vcs.repository.name", label: "Repository" },
  { source: "resource", key: "deployment.environment", label: "Environment" },
  { source: "resource", key: "host.name", label: "Host" },
];
```

Clicking a chip adds an `in` filter for that key, or focuses the existing row if already active.

### Data wiring (`data/options.ts`, `data/repository.ts`, `data/client.ts`)

- `logAttributeKeysOptions(repo, { timeRange })` → new `repo.attributeKeys(...)`.
- `logAttributeValuesOptions(repo, { timeRange, source, key })` → new `repo.attributeValues(...)`,
  enabled only for keys with an active `in`/`not_in` row, so values are never fetched for
  unopened keys (the core of Approach A).

## Wiring (`packages/app/src/routes/_authenticated/_dashboard/logs.tsx`)

- The route's `SearchSchema` spreads `LogsSearchFiltersShape`, so `attributes` becomes a URL
  search param automatically — TanStack Router serializes the array of filter objects, the
  same mechanism that already handles the `levels`/`services` arrays. Shareable/bookmarkable
  for free.
- **Retire `repos`:** remove the `repos` field, its query in `filter-options.ts`, and its
  branch in `where.ts`. Repository is now represented through `attributes`. Old bookmarked
  URLs carrying `?repos=…` are harmlessly ignored (zod strips unknown keys).
- `LogsExplorerSearch` gains `attributes`; the mapping block in `LogsExplorerPage` passes it
  through alongside `levels`/`services`. `LogsExplorer` threads it into `LogFiltersBar` and
  into the explorer/totals/histogram query inputs.
- `filter-options.ts` shrinks to just the Service list. Service stays as-is (a column filter),
  not folded into the generic value-discovery path, to keep this change focused.

## Testing

Follows the existing `logs/sql/*.test.ts` vitest pattern.

- **`attribute-keys.test.ts`** — union across all three maps, time-range params bound,
  `LIMIT` cap present.
- **`attribute-values.test.ts`** — source→column whitelist resolves correctly, `key` bound
  as a param, `mapContains` guard present, rejects unknown source.
- **`where.test.ts`** (extend) — one case per op, indexed param names, multiple filters AND
  together, `exists`/`missing` ignore `values`, `not_in` includes logs missing the attribute.
- **schemas** — `AttributeFilterSchema` validation and defaults.
- **`explorer`/`totals`/`histogram` tests** — updated for the `buildWhereClause` →
  `{ clause, params }` return change; confirm params still merge correctly.
- **UI components** — no existing test precedent in `logs/ui/`; verified manually (load the
  Logs page, add a filter, confirm results narrow and the URL updates).
