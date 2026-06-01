# Dynamic Attribute Filters for Errors & Traces (shared module) — Design

**Date:** 2026-06-01
**Branch:** `gio/attribute-filters-traces-errors` (stacked on `gio/dynamic-log-attribute-filters`, PR #164)

## Goal

Bring the dynamic OTel attribute-filter UI shipped on the logs page to the
**errors** and **trace search** pages, and along the way **match the trace
search filter layout to the logs sidebar**. The reusable parts of the logs
implementation are extracted into a shared `attribute-filter` module so all
three domains share one source of truth.

## Background

The logs page (PR #164) gained dynamic attribute filtering across the OTel
attribute maps with `Is` / `Is not` / `Exists` / `Missing` operators, lazy
key→value discovery, promoted quick-picks, and a pill + popover-editor UI.
Those components currently live under `src/logs/` and are named `Log*`, but are
~90–100% generic. The only logs-specific pieces are: the attribute-map column
mapping, the promoted-keys list, and the `service.name` exclusion.

The two target domains differ:

- **Errors** query the *same logs table*, so they have the identical
  `resource | log | scope` attribute maps. Errors currently have **no dynamic
  WHERE builder** — just a service filter and a hardcoded exception predicate.
- **Traces** query a different table exposing `ResourceAttributes` +
  **`SpanAttributes`** (no `scope` map), use a **two-pass** query (span-level
  row filter inside, trace-level aggregation outside), and render a
  **horizontal filter bar** rather than the logs sidebar.

## Decisions (locked)

1. **Sharing approach:** extract a shared `src/attribute-filter/` module;
   refactor logs to consume it; errors + traces then consume it. One source of
   truth.
2. **Branch base:** stack on `gio/dynamic-log-attribute-filters` (PR #164). It
   merges first; this stacks on top. Rebase if #164 changes in review.
3. **Trace sources & semantics:** offer **Resource + Span** attribute sources
   (traces have no scope map); a trace matches if **any of its spans** satisfies
   the filter (applied in the inner span-level WHERE of the two-pass query).

## Architecture

### Shared module — `packages/telemetry-explorer/src/attribute-filter/`

Extracted from the logs implementation and de-logs-ified.

#### `schemas.ts`

Generic types, with `AttributeSource` widened to a superset:

- `AttributeSourceSchema = z.enum(["resource", "log", "scope", "span"])`
- `AttributeOpSchema = z.enum(["in", "not_in", "exists", "missing"])`
- `AttributeFilterSchema = z.object({ source, key: z.string().min(1), op, values: z.array(z.string()).default([]) })`
- `AttributeKey = { source: AttributeSource; key: string }`
- `AttributeKeysInput = { timeRange: TimeRange }`
- `AttributeValuesInput = { timeRange: TimeRange; source: AttributeSource; key: string }`

Validation is permissive over all four sources; each domain restricts which it
*offers* via a `sources` prop. Logs/errors use `resource | log | scope`; traces
use `resource | span`.

#### `sql/where.ts`

Extract only the **attribute-clause builder** (not the whole logs WHERE):

```ts
export function buildAttributeClauses(
  attributes: AttributeFilter[],
  columnFor: (source: AttributeSource) => string,
  startIndex = 0,
): { clauses: string[]; params: Record<string, unknown> }
```

Preserves the existing logs semantics exactly:

- `in`: empty values → no-op (skip). Else `mapContains(col,{k}) AND col[{k}] IN {vals}`.
- `not_in`: empty values → no-op. Else `(NOT mapContains(col,{k}) OR col[{k}] NOT IN {vals})` (includes missing-key rows).
- `exists`: `mapContains(col,{k})`.
- `missing`: `NOT mapContains(col,{k})`.

Param names are indexed from `startIndex`: `attrKey{i}` / `attrVals{i}`. The
`startIndex` lets a caller that already has positional params avoid collisions.
Each domain keeps its own overall WHERE assembly and calls this for the
attribute portion.

`columnFor` is injected per domain:

- logs/errors: `{ resource: "ResourceAttributes", log: "LogAttributes", scope: "ScopeAttributes" }`
- traces: `{ resource: "ResourceAttributes", span: "SpanAttributes" }`

#### `sql/keys.ts` + `sql/values.ts`

The discovery queries, generalized to take a `sources` list, a `columnFor`
mapping, and `tableName`:

```ts
buildAttributeKeysQuery(
  input: { timeRange: TimeRange },
  opts: { tableName: string; sources: AttributeSource[]; columnFor: (s: AttributeSource) => string },
): BuiltQuery

buildAttributeValuesQuery(
  input: { timeRange: TimeRange; source: AttributeSource; key: string },
  opts: { tableName: string; columnFor: (s: AttributeSource) => string },
): BuiltQuery
```

Keys query: `UNION ALL` over `sources` of `SELECT DISTINCT arrayJoin(mapKeys(col)) AS key, '<source>' AS source`, `WHERE key != '' ORDER BY source, key LIMIT 500`. Values query unchanged except column injected; `LIMIT 100`.

#### `repository.ts`

```ts
export type AttributeRepositoryLike = {
  attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]>;
  attributeValues(input: AttributeValuesInput): Promise<string[]>;
};
```

Each domain repository implements this slice.

#### `options.ts`

```ts
attributeKeysOptions(repo, input, { domain })     // domain: "logs" | "errors" | "traces"
attributeValuesOptions(repo, input, { domain })
```

The `domain` namespaces the React Query keys: `[domain, "attributeKeys", timeRange]`.

#### `ui/`

- **`attribute-meta.ts`** — `ATTRIBUTE_OP_LABELS`, `ATTRIBUTE_OP_CONNECTORS`,
  `opTakesValues`, `attributeLabel`, the `KNOWN_ATTRIBUTE_LABELS` dictionary,
  and `ATTRIBUTE_SOURCE_LABELS` with `span: "Span"` added. `PromotedAttribute`
  type = `{ source, key }`.
- **`attribute-filter-pill.tsx`**, **`attribute-key-picker.tsx`**,
  **`attribute-filter-section.tsx`** — moved verbatim except: the repo type
  becomes `AttributeRepositoryLike`, value/key options come from the shared
  `options.ts` (passed the `domain`), and the picker/section take
  `promotedAttributes`, `excludedKeys`, and `sources` as **props** instead of
  module constants.

### Logs refactor (Phase 0)

- `logs/schemas.ts` re-exports/aliases the shared attribute types
  (`AttributeFilter`, `AttributeSource`, `AttributeOp`, `AttributeKey`,
  `AttributeKeysInput`, `AttributeValuesInput`) so existing logs imports keep
  working.
- `LogsRepository` already has `attributeKeys`/`attributeValues`; reimplement
  them against the shared SQL builders with the logs column mapping. It already
  satisfies `AttributeRepositoryLike`.
- Logs SQL `where.ts` calls the shared `buildAttributeClauses` for its
  attribute portion (keeping its level/service/query/traceId logic local).
- Logs UI passes its own props: promoted `[Repository, Environment, Host]`,
  excluded `["resource:service.name"]`, sources `["resource","log","scope"]`.
- **The existing logs tests are the regression guard** — behavior is unchanged.

### Errors integration (Phase 1)

Errors query the logs table, so the full `resource | log | scope` source set
applies.

- **SQL (`errors/sql/issues.ts`):** thread `attributes` into the row-level
  exception predicate used by **both** `buildSummaryQuery` (issue list) and
  `buildServicesQuery` (so the service facet reflects active attribute filters,
  matching logs). Each gains an `attributes` input and appends
  `buildAttributeClauses(attributes, errorsColumnFor, startIndex)` to its WHERE,
  spreading the returned params. `buildOccurrencesQuery` stays unfiltered (the
  user has already drilled into an issue).
- **Schemas (`errors/data/schemas.ts`):** add
  `attributes: z.array(AttributeFilterSchema).default([])` to
  `ErrorIssueSearchSchema`, `SearchErrorIssuesInputSchema`, and
  `ListErrorServicesInputSchema`.
- **Repository:** add `attributeKeys`/`attributeValues` (errors table,
  `resource|log|scope` mapping); widen `ErrorsRepositoryLike`.
- **Options + server fns:** `errorAttributeKeys/ValuesOptions` (domain
  `"errors"`); `getErrorAttributeKeys`/`getErrorAttributeValues` in
  `app/src/data/errors/server.ts`; wire `remoteErrorsRepo`. Desktop's local
  `ErrorsRepository` gets it for free.
- **UI (`errors/ui/error-filters.tsx`):** errors already render a 260px
  sidebar, so this is purely additive — drop `<AttributeFilterSection>` (errors'
  promoted/excluded/sources props) below the Service combobox, separated like
  logs. No layout restructure.

### Traces integration + layout match (Phase 2)

- **Layout:** convert `traces/ui/trace-filters.tsx` from the horizontal
  `flex-wrap` bar into the logs vertical sidebar, and wrap
  `traces-search-page.tsx` in the same grid
  (`lg:grid-cols-[260px_minmax(0,1fr)]` with an `<aside>`). Sidebar order:

  ```
  Filter (header w/ icon)
  Status  [All] [Ok] [Error]      ← promoted to top, like log levels
  ──────────
  Namespace  (combobox)
  Service    (combobox)
  ──────────
  Name       (span-name contains)
  Min ms / Max ms
  ──────────
  Attributes (AttributeFilterSection: Resource + Span)
  Clear filters
  ```

  Desktop's `traces-page.tsx` reuses `TracesSearch`, so the layout flows
  through automatically.

- **SQL:** attribute clauses go into the **inner span-level WHERE** of the
  two-pass query (alongside name/service/namespace), so a trace is kept if it
  has a span satisfying the filters. **Semantic note:** because all row-level
  predicates apply per-span, multiple *span*-attribute filters must be satisfied
  by the **same span**; resource attributes are trace-uniform and unaffected.
  This is the natural reading of "any-span match" and consistent with how
  name+service already compose.

- **Schemas:** add `attributes` to `TraceSearchParamsSchema` +
  `SearchTracesInputSchema`.

- **Repository / options / server fns:** add `attributeKeys`/`attributeValues`
  to `TracesRepository` (traces table, `resource|span` mapping) and
  `TracesRepositoryLike`; add `traceAttributeKeys/ValuesOptions` (domain
  `"traces"`), the two server fns, and `remoteTracesRepo` wiring.

- **Promoted attributes (traces):** exclude `resource:service.name` (it's the
  Service filter); promote a span/resource mix — e.g. `http.route`,
  `db.system`, `rpc.method` (span) and `deployment.environment` (resource).
  Tunable during implementation.

## Data Flow

1. User opens a filter picker → `attributeKeysOptions(repo, {timeRange}, {domain})`
   lazily fetches distinct keys across the domain's `sources` for the current
   range.
2. User picks a key → a pending pill mounts with its editor open; selecting
   `in`/`not_in` fires `attributeValuesOptions` to lazily fetch distinct values
   for that `source:key`.
3. Filters serialize into the route's `validateSearch` schema (URL state).
4. Server fn validates the input schema and the domain repository builds its
   query, calling `buildAttributeClauses` for the attribute portion.

## Error Handling

- Empty-value `in`/`not_in` filters are no-ops (no clause, no orphan param) —
  avoids the always-false `IN ()` trap. Preserved from logs.
- The picker only suggests promoted keys that actually appear in the current
  range, and falls through to an empty state when discovery returns nothing.
  Preserved from logs.
- SQL injection safety: columns come from the per-domain `columnFor` whitelist;
  keys and values are bound params.

## Testing

- **Shared module:** unit tests for `buildAttributeClauses` (each op, empty-value
  no-op, `startIndex` offset, injected column mapping), `keys.ts`/`values.ts`
  (source union, column injection), and jsdom render tests for the three UI
  components (props-driven promoted/excluded/sources).
- **Logs:** existing tests are the regression guard — must stay green through
  the refactor unchanged.
- **Errors:** WHERE-threading tests for summary + services queries; schema
  round-trip; a render test that the attribute section appears in the errors
  sidebar.
- **Traces:** inner-WHERE attribute-clause test; schema round-trip; a render
  test for the new sidebar layout (sections present, order) and the attribute
  section.
- **Cross-package:** `@everr/desktop-app` has **no typecheck script** — verify
  with `cd packages/desktop-app && pnpm exec tsc --noEmit` after the shared-type
  rename and after each phase.

## Implementation Phasing

Single stacked branch, phased so each phase is independently reviewable (and
could be split into its own PR off the stack if desired):

- **Phase 0** — shared extraction + logs refactor (logs tests guard).
- **Phase 1** — errors filters.
- **Phase 2** — traces filters + sidebar layout match.

## Out of Scope

- Histogram/volume for traces or errors (logs-only).
- Filtering occurrences within an already-selected error issue.
- Reordering or restructuring logs filters (logs UI unchanged behaviorally).
