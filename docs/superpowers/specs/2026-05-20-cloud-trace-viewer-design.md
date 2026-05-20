# Cloud Trace Viewer — Design (MVP)

Date: 2026-05-20
Status: Spec approved, pending implementation plan

## Summary

Add a `/traces` page to the web app at `packages/app` that lets engineers search and inspect OpenTelemetry traces stored in ClickHouse (`app.traces`). MVP scope: a search page with URL-state filters, and a detail page with two tabs — Timeline (Gantt) and raw JSON. Other analytical views (stats, critical path, flat spans table) are explicitly deferred.

This replaces the earlier [Local Trace Viewer](2026-04-15-local-trace-viewer-design.md) design. Rather than embedding the viewer in the desktop app and reading local OTLP JSON files via Tauri, we build it in the web app against the existing cloud-telemetry pipeline. That shortcuts an entire backend layer (Tauri commands + file-scan + new aggregation + new DTO crate) and reuses the web app's auth, routing, time-range picker, and refresh infrastructure.

## Goals

- Interactive trace browsing inside the existing web app — no new shell, no new package.
- Search across recent traces with URL-state filters: time range, span name, service namespace, service name, status, duration range.
- Drill into a single trace and see a virtualized Gantt timeline + raw JSON.
- Reuse the web app's established conventions for server functions, ClickHouse queries, URL state, and auto-refresh — no new patterns invented.

## Non-goals

- Trace statistics tab.
- Critical path tab.
- Flat spans table tab.
- Multi-trace aggregate views (dependency graph, monitor, etc.).
- Trace diff / compare.
- Free-form attribute (`k=v`) filters in MVP.
- Multi-instance `ProcessId` distinction. Process is keyed by `(service.namespace, service.name)`.
- Clock-skew rendering, orphan synthetic root, partial-trace warnings. Resilience added later if real traces demand it.
- Local-OTLP-file paths, desktop-app surface, Tauri commands, sidecars. None of it.

## Architecture

```
┌─ packages/app (React, TanStack Router/Query) ──────┐
│  /traces                  search list + filters    │
│  /traces/$traceId         detail (tab via ?tab=)   │
│                                                    │
│  URL-state: time range, refresh, filters, active tab
│                                                    │
│  TanStack Query ─► searchTraces() ──┐              │
│                  ─► getTrace(id) ───┤ server fns   │
│                  ─► listServiceIdentities() ┘      │
└─────────────────────────────────────┬──────────────┘
                                      ▼
┌─ packages/app/src/data/traces/server.ts ───────────┐
│  createAuthenticatedServerFn × 3                   │
│  Inject ClickHouse client via requireOrgMiddleware:│
│    clickhouse_settings.SQL_everr_tenant_id = orgId │
│  Row-level policy on app.traces does tenant scope. │
└────────────────────┬───────────────────────────────┘
                     ▼
                app.traces (ClickHouse)
```

### Why this shape

- **Web app, not desktop app.** Cloud is the primary observation surface; the same engineers default to `everr cloud query` over local. The web app already has the auth, picker, and ClickHouse plumbing this needs. Building in the desktop app would duplicate infrastructure for a worse default.
- **No new infra, just a new page.** Server-fn + TanStack Query pattern, time picker, refresh picker, auth middleware, ClickHouse client are all in place. The work is one page, two views, three server functions.
- **No new tables, no MVs.** Filter and aggregate are SQL over `app.traces`. Performance optimizations (per-trace summary MV, materialized `service.namespace` column) deferred until we see real numbers.

## Routes and URL state

TanStack file-based router. Both routes nest under `_authenticated/_dashboard` so the `TimeRangePicker` + `RefreshPicker` from the dashboard layout render automatically.

```
/_authenticated/_dashboard/traces.tsx              # search page
/_authenticated/_dashboard/traces/$traceId.tsx     # detail page
```

Search-page search params (zod-validated via `validateSearch`):

| Param       | Type               | Default  | Notes                                       |
|-------------|--------------------|----------|---------------------------------------------|
| `from`      | datemath           | `now-1h` | `@everr/datemath`, same as other pages      |
| `to`        | datemath           | `now`    |                                             |
| `refresh`   | `RefreshInterval`  | `off`    | reused from `@everr/ui`                     |
| `namespace` | string[]           | `[]`     | multi-select on `service.namespace`         |
| `service`   | string[]           | `[]`     | multi-select on `service.name`              |
| `name`      | string             | `""`     | substring match on span name                |
| `minMs`     | number?            | —        | duration ≥                                  |
| `maxMs`     | number?            | —        | duration ≤                                  |
| `status`    | `ok | error | all` | `all`    | root-span status                            |
| `limit`     | number             | `50`     |                                             |

Detail-page search params:

| Param  | Type   | Default     | Notes                                  |
|--------|--------|-------------|----------------------------------------|
| `tab`  | enum   | `timeline`  | `timeline | json`                      |
| `span` | string | —           | focused span (highlighted + scrolled)  |

URL is the single source of truth. Reloads and deep links restore the exact view. Datemath resolution happens client-side in the fetcher, not in the queryKey — keys hold raw strings so `now-1h` / `now` don't churn the cache.

## Server functions

All three live in `packages/app/src/data/traces/server.ts` as `createAuthenticatedServerFn`. ClickHouse is reached via the `clickhouse` context injected by `requireOrgMiddleware` — `clickhouse_settings.SQL_everr_tenant_id` is set automatically, so **no `tenant_id` clauses appear in any WHERE**.

### `searchTraces(input: TraceSearchInput) → TraceSummary[]`

Two-pass query so trace summaries reflect the full trace, not just the spans that survived the filter.

```sql
WITH matching_traces AS (
  SELECT DISTINCT TraceId
  FROM app.traces
  WHERE Timestamp BETWEEN ? AND ?
    AND (? = '' OR SpanName ILIKE ?)
    AND (empty(?) OR ServiceName IN ?)
    AND (empty(?) OR ResourceAttributes['service.namespace'] IN ?)
  LIMIT 1000           -- guard against wide+permissive filters
)
SELECT
  TraceId,
  coalesce(
    argMinIf(SpanName,    (Timestamp, SpanId), ParentSpanId = ''),
    argMin  (SpanName,    (Timestamp, SpanId))
  ) AS root_name,
  coalesce(
    argMinIf(ServiceName, (Timestamp, SpanId), ParentSpanId = ''),
    argMin  (ServiceName, (Timestamp, SpanId))
  ) AS root_service,
  coalesce(
    argMinIf(StatusCode,  (Timestamp, SpanId), ParentSpanId = ''),
    argMin  (StatusCode,  (Timestamp, SpanId))
  ) AS root_status,
  min(Timestamp)                AS start_ts,
  toUInt64(dateDiff('nanosecond', min(Timestamp),
                    max(addNanoseconds(Timestamp, Duration)))) AS duration_ns,
  count()                       AS span_count,
  countIf(StatusCode = 'Error') AS error_count,
  groupUniqArray(ServiceName)   AS services
FROM app.traces
WHERE TraceId IN (SELECT TraceId FROM matching_traces)
GROUP BY TraceId
HAVING (? = 0     OR duration_ns >= ?)
   AND (? = 0     OR duration_ns <= ?)
   AND (? = 'all' OR root_status = ?)
ORDER BY start_ts DESC
LIMIT ?
```

### `getTrace(traceId: string) → Span[]`

One query, all spans, no pagination. Virtuoso virtualizes the render.

```sql
SELECT
  TraceId, SpanId, ParentSpanId,
  SpanName, ServiceName,
  ResourceAttributes['service.namespace'] AS service_namespace,
  Timestamp, Duration, StatusCode, SpanKind,
  SpanAttributes, ResourceAttributes, Events, Links
FROM app.traces
WHERE TraceId = ?
ORDER BY Timestamp ASC
```

### `listServiceIdentities(input: TimeWindow) → ServiceIdentity[]`

Feeds the namespace and service multi-selects on the search page.

```sql
SELECT DISTINCT
  ResourceAttributes['service.namespace'] AS service_namespace,
  ServiceName AS service_name
FROM app.traces
WHERE Timestamp BETWEEN ? AND ?
ORDER BY service_namespace, service_name
```

### Schema realities baked into the queries

- `ParentSpanId = ''` for roots (not NULL). Root election uses that predicate.
- `StatusCode` is the string `"Ok"` / `"Error"` / `"Unset"`. Status filter compares strings.
- `service.namespace` lives in `ResourceAttributes` map — no column. Filtering uses `ResourceAttributes['service.namespace']`. Slower than a real column; if it gets hot, materialize a column or projection. Not in MVP.
- `Duration UInt64` in ns; `Timestamp DateTime64(9)`.

### Tradeoffs

1. **Filters match at the span level**, not the root span. Searching `name=checkout` returns any trace containing a `checkout` span — the triage shape, not the structural shape.
2. **Window means "trace has at least one span in this window"**, but trace summary stats (`start_ts`, `duration_ns`, `span_count`, `error_count`, `services`) come from the **full trace**, not the in-window subset. A trace surfaced because one late span landed in the window still shows its real full duration and full service list.

### Root election

Spec rules, applied deterministically so search results are stable across scans:

1. If exactly one span has `ParentSpanId = ''`, that is the root.
2. If multiple roots, pick the one with smallest `(Timestamp, SpanId)`.
3. If no span has `ParentSpanId = ''`, fall back to the trace's overall earliest span by `(Timestamp, SpanId)` — approximation of "orphan root"; cheap and stable, skips the self-join the strict spec rule would require.

Implemented in SQL via `coalesce(argMinIf(..., ParentSpanId = ''), argMin(..., …))` for each root-derived column.

### DTOs (TypeScript)

Match SQL output 1:1; no Rust crate, no Tauri serde layer.

```ts
type TraceSummary = {
  traceId: string;
  rootName: string;
  rootService: string;
  rootStatus: 'Ok' | 'Error' | 'Unset';
  startTs: string;          // DateTime64(9) serialized
  durationNs: string;       // UInt64 as string from CH driver
  spanCount: number;
  errorCount: number;
  services: string[];
};

type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  spanName: string;
  serviceName: string;
  serviceNamespace: string;
  timestamp: string;
  duration: string;
  statusCode: 'Ok' | 'Error' | 'Unset';
  spanKind: string;
  spanAttributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  events: SpanEvent[];
  links: SpanLink[];
};

type ServiceIdentity = { serviceNamespace: string; serviceName: string };
```

## Frontend structure

```
packages/app/src/
├── routes/_authenticated/_dashboard/
│   ├── traces.tsx                         # /traces — search page
│   └── traces/
│       └── $traceId.tsx                   # /traces/$traceId — detail page
├── data/traces/
│   ├── server.ts                          # createAuthenticatedServerFn × 3
│   └── options.ts                         # queryOptions for each
└── components/traces/
    ├── trace-filters.tsx                  # namespace + service multi-selects, name, duration, status
    ├── trace-results-list.tsx             # Virtuoso list of TraceSummary
    ├── duration-bar.tsx                   # relative-to-slowest bar
    ├── trace-detail-tabs.tsx              # Timeline | JSON (via ?tab=)
    ├── timeline/
    │   ├── timeline-view.tsx              # Virtuoso-virtualized Gantt
    │   ├── span-row.tsx
    │   ├── span-bar.tsx
    │   ├── span-detail-panel.tsx          # selected span attributes/events
    │   └── use-timeline-layout.ts         # flat Span[] → ordered rows + collapse state
    ├── json/
    │   └── json-view.tsx                  # raw spans JSON, syntax-highlighted
    └── shared/
        ├── service-color.ts               # stable hash of "ns/name" → CSS var
        └── format-duration.ts             # ns → human string
```

### Component boundaries

- **Timeline is the only expensive piece.** `use-timeline-layout.ts` owns the transform from flat `Span[]` → displayable rows with collapse state. `span-row.tsx` / `span-bar.tsx` stay presentational. `<Virtuoso>` wraps the row list.
- **Stats, critical path, and spans-table** are not in this scope.
- **JSON view** is trivial; uses an existing JSON renderer if one is in the app, falls back to a `<pre>` block.
- **Filter UI** copies `logs.tsx`'s shape: chips above the results list, debounced text inputs, instant-apply on change.

### Virtuoso, not @tanstack/react-virtual

- Results list: `<Virtuoso>` keyed by `traceId`.
- Timeline: `<Virtuoso>` over the flat row model from `use-timeline-layout.ts`. Span bars are absolutely-positioned children of each row; only the row container is virtualized.
- **No pagination inside a trace** — `getTrace` returns every span and the list renders all of them.

Virtuoso added to `packages/app/package.json` as part of this work.

### Deliberately absent

- No Redux, no global state. URL + TanStack Query is the state model.
- No drag-to-pan / pinch-zoom in MVP. Wheel zoom + click-drag on the axis to set a range is enough; revisit if it feels off.
- No cursor pagination. `limit` param with a "load more" button (increasing `limit`) covers MVP.
- No service-color theming work beyond a stable-hash → CSS-var lookup. Palette lives in CSS vars so a future theme switch is one-file.

## Data flow

1. User lands on `/traces`. Search params default to `from=now-1h&to=now&refresh=off`.
2. `tracesSearchOptions(input)` is a `queryOptions` factory keyed on the **raw datemath strings** (`from`, `to`) plus other filter params. The fetcher resolves datemath via `withTimeRange()` (matches `logs.tsx`) and invokes the `searchTraces` server function. Raw strings in the key keep `now-1h` / `now` from causing refetches on every render.
3. `RefreshPicker` from the parent `_dashboard.tsx` layout drives `useAutoRefresh`, which invalidates the active search query on its interval. Datemath resolves fresh on each invalidation, so `now` slides forward naturally.
4. Clicking a row navigates to `/traces/$traceId?tab=timeline`. The route's loader prefetches `getTraceOptions(traceId)`; the page calls `useQuery(getTraceOptions(traceId))`.
5. **Detail page inherits the refresh interval via URL**: opening from a search list with `refresh=15s` carries `refresh=15s` into the detail URL. When the interval fires, `getTrace` reruns and adds any new spans appended since the previous fetch. When `refresh=off`, the detail page exposes a manual refresh button.
6. `listServiceIdentities` runs on mount of the search page; its result populates the namespace and service multi-selects. Re-runs only when the time window changes.

## Error handling and edge cases

### Search page states

| State            | Trigger                | UI                                                                |
|------------------|------------------------|-------------------------------------------------------------------|
| No results       | empty result rows      | Empty state with quick actions: widen to `now-24h`, clear filters.|
| ClickHouse error | server-fn rejection    | Inline error card + retry.                                        |

### Detail page states

| State            | Trigger                | UI                                                                |
|------------------|------------------------|-------------------------------------------------------------------|
| Trace not found  | zero spans returned    | "No spans for this trace ID." + link back to search.              |
| ClickHouse error | server-fn rejection    | Inline error card + retry.                                        |

### Data handled in `use-timeline-layout.ts`

- **Zero-duration spans:** render as a 1px tick; still selectable.
- **Very long traces:** virtualized list with a collapse-all toggle; the JSON tab is the always-available escape hatch.

### Out of scope

- Clock-skew clamping, orphan synthetic root, partial-trace warnings.
- In-progress-trace shape-hashing / equality-skipping on refetch. With Virtuoso this stays smooth at any reasonable size; revisit only if a refetch causes visible jank.
- Cross-region / cross-tenant access. Tenant scoping is the existing row-level policy on `app.traces`.

## Testing

### Server function tests (vitest)

- Three server functions: happy path + one error path per command (`trace_not_found`, ClickHouse rejection).
- SQL string snapshot for the search query under representative filter combinations (no filters, all filters, one of each).
- No mocked ClickHouse — pointed at a test database seeded with fixtures, matching the pattern used by the existing data layer.

### Frontend pure-function tests (vitest)

- `use-timeline-layout.ts` — flat → ordered rows, collapse state, zero-duration handling.
- `service-color.ts` — stable across renders and across the search + timeline views.
- `format-duration.ts` — ns → human string at each scale boundary.

### Component tests (React Testing Library)

- `trace-results-list` — N rows render, duration-bar widths, click navigates (router mock).
- `timeline-view` — fixture loads, expand/collapse subtree, select a span → detail panel shows attributes.
- `trace-filters` — namespace + service multi-selects populate from `listServiceIdentities`, status/duration filters apply to URL state.

### Out of scope for MVP testing

- End-to-end tests across the routes.
- Performance benchmarks on >10k-span traces.
- Snapshot tests for timeline markup (rot with every style change).

## Resolved architectural decisions

### Web app, not desktop app

The local-trace-viewer design ([2026-04-15](2026-04-15-local-trace-viewer-design.md)) embedded the viewer in the desktop app and read OTLP JSON files via Tauri commands. We have decided to build cloud-first: the same engineers default to cloud telemetry, and the web app already has the auth, picker, and ClickHouse plumbing this needs. Building in the desktop app would duplicate infrastructure for a worse default.

The local viewer is deferred, not killed. If we revive it, this spec's frontend components are reusable (timeline + filters don't care about the data source) and only the data layer changes.

### Single table, no MV

Both the search and get-trace queries hit `app.traces` directly. The two-pass search query is bounded by the inner `LIMIT 1000` cap and the outer `LIMIT 50`. If we hit perf cliffs, the obvious next step is a per-trace summary MV (`traces_summary` keyed by `TraceId`) so the search query reads one row per trace. We are not building that yet.

### `service.namespace` filtering via the map

`service.namespace` lives in `ResourceAttributes`. Filtering via `ResourceAttributes['service.namespace'] IN (…)` is slower than a real column but acceptable for MVP volumes. If the namespace filter becomes a hotspot, the fix is a materialized column or a `service_identity_summary` projection. Until we see real query times, we leave it.

### Two tabs only

Stats, critical path, and spans-table are out of MVP scope. Each is independently shippable later: the spans-table is essentially free once the trace is loaded; stats is a pure function over the loaded trace; critical-path piggybacks on the timeline. Cutting them now keeps the surface area small enough for a fast first ship; their absence is documented above as "deliberately absent."

### Virtuoso over `@tanstack/react-virtual`

Picked for its simpler API: we want one virtualization story across the results list and the timeline rows, and the React-friendly defaults beat `react-virtual`'s lower-level API for our usage. The trace-detail view loads every span and virtualizes the render — there is no pagination inside a trace.

### Refresh

The web app's `useAutoRefresh` and `RefreshPicker` are already route-agnostic and rendered by the `_dashboard.tsx` parent layout based on `staticData`. Both new routes opt in via `staticData`; no refactor needed.
