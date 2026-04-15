# Local Trace Viewer — Design

Date: 2026-04-15
Status: Spec approved, pending implementation plan

## Summary

Embed a local trace viewer as a new top-level page in the Everr desktop app. It reads OTLP JSON files written by the local collector — the same files the `everr telemetry traces` CLI reads today — and presents a Jaeger-like UI: search + filter across recent traces, then drill into a single trace across four views (timeline / statistics / critical path / spans) plus a raw JSON view.

The UI is reimplemented in the desktop app's existing stack (React + Shadcn + BaseUI + Tailwind + TanStack Query/Router). `jaeger-ui` (vendored at `jaeger-ui/`) is the visual and interaction reference, not a source dependency.

## Goals

- Interactive trace browsing without leaving the desktop app.
- Full view parity on a single trace: timeline (Gantt), trace statistics, critical path, flat span table, raw JSON.
- Share URL conventions with the existing web app (`@everr/app`) — time-range picker, refresh picker, URL-state filters.
- Reuse existing Rust telemetry code (`packages/desktop-app/src-cli/src/telemetry/{store,query,otlp}.rs`) via new Tauri commands. No duplication of parsing or file-scanning logic.

## Non-goals

- Multi-trace aggregate views (dependency graph, deep dependencies, monitor, quality metrics). These are explicitly out of MVP scope.
- Trace diff / compare.
- Indexed storage (SQLite/DuckDB). We accept the file-scan perf tradeoff for now; revisit only if it becomes painful.
- Live tail / push streaming. Auto-refresh on a timer is sufficient.
- End-to-end Tauri tests and performance benchmarks.

## Architecture

```
┌─ Desktop app (React) ──────────────────────────────┐
│  /traces                 search list + filters     │
│  /traces/$traceId        trace view (tabs)         │
│                                                    │
│  URL-state: time range, filters, refresh, active tab
│                                                    │
│  TanStack Query ─────► invoke('telemetry_search_traces', …)
│                   ────► invoke('telemetry_get_trace', id)
│                   ────► invoke('telemetry_list_services', …)
└────────────────────────┬───────────────────────────┘
                         │ Tauri IPC
┌─ src-tauri (Rust) ─────▼───────────────────────────┐
│  New commands reuse existing telemetry modules:    │
│  TelemetryStore + query.rs + otlp.rs               │
│  File-scan on demand (same path the CLI uses).     │
└────────────────────────────────────────────────────┘
```

### Why this shape

- **Top-level page** rather than nested under `developer`: first-class placement matches how this will actually get used (trace viewing is a primary workflow, not a debug hatch).
- **Reimplement in the app's stack**: `jaeger-ui` uses antd + Less + Redux + `redux-actions`. Embedding it would mean two design systems (antd vs Shadcn/BaseUI) and Redux-legacy patterns coexisting inside one Tauri app. Feature parity on four screens is tractable when we control the data shape.
- **File-scan backend**: we accept the perf tradeoff to avoid standing up an index layer. Single-trace loading is already decent in the CLI; the search/stats paths will be the first to feel slow and can be optimized later.

## Routes and URL state

TanStack Router file routes:

```
/traces                               Search page
/traces/$traceId                      Trace detail page (tabs via ?tab=)
```

Search-page search params (zod-validated):

| Param     | Type            | Default   | Notes                                   |
|-----------|-----------------|-----------|-----------------------------------------|
| `from`    | datemath        | `now-1h`  | same syntax as CLI (`@everr/datemath`)  |
| `to`      | datemath        | `now`     |                                         |
| `refresh` | `RefreshInterval` | `off`   | reused from `@everr/ui`                 |
| `service` | string[]        | `[]`      | multi-select                            |
| `name`    | string          | `""`      | substring match on span name            |
| `attr`    | `k=v`[]         | `[]`      | tag/attribute filters, repeatable       |
| `minMs`   | number?         | —         | duration ≥                              |
| `maxMs`   | number?         | —         | duration ≤                              |
| `limit`   | number          | `50`      |                                         |
| `status`  | `ok | error | all` | `all`  | root-span status                        |

Trace-detail search params:

| Param     | Type   | Default     | Notes                                    |
|-----------|--------|-------------|------------------------------------------|
| `tab`     | enum   | `timeline`  | `timeline | stats | critical-path | spans | json` |
| `span`    | string | —           | focused span ID (highlighted/scrolled)   |
| `group`   | enum   | `operation` | stats grouping: `operation | service | tag` |
| `groupBy` | string | —           | attribute key used when `group=tag` (e.g. `http.method`). Required for `group=tag`; ignored otherwise. The stats UI shows a dropdown populated from distinct attribute keys present in the loaded trace. |

URL-state is the single source of truth for filters and view state. Reloads and deep links restore the exact view. Datemath resolution happens client-side before calling Rust — matches the web app convention, keeps the backend timestamp-only.

## Tauri commands

Added in `packages/desktop-app/src-tauri/src/telemetry/`, wired in `mod.rs`. Most call into existing CLI telemetry modules; a few require new Rust code, called out explicitly below. Shared types live in a crate both the CLI binary and Tauri depend on (no duplication).

### Required backend changes

The existing `TraceFilter` in `packages/desktop-app/src-cli/src/telemetry/query.rs` does not match the UI's needs and must be extended as part of this work:

| Field          | Current                  | Required                  | Reason                          |
|----------------|--------------------------|---------------------------|---------------------------------|
| `service`      | `Option<String>`         | `Vec<String>` (empty = all)| Multi-service filter in the UI  |
| `status`       | (absent)                 | `Option<SpanStatusFilter>` with `ok | error | all` | Root-span status filter |
| `min_duration_ns` / `max_duration_ns` | (absent) | `Option<u64>` each    | Duration range filter           |

These changes must be backwards-compatible with the CLI's current usage (`--service <name>` maps to `vec![name]`). The CLI's printed output is unchanged; only the filter shape grows.

```rust
#[tauri::command]
async fn telemetry_search_traces(filter: TraceFilter) -> Result<TraceSummaryPage, TelemetryError>;

#[tauri::command]
async fn telemetry_get_trace(trace_id: String) -> Result<Trace, TelemetryError>;

#[tauri::command]
async fn telemetry_list_services(from_ns: u64, to_ns: u64) -> Result<Vec<String>, TelemetryError>;
```

### DTOs

`TraceFilter` mirrors the URL-state search params, with `from`/`to` resolved to absolute ns on the client.

```rust
struct TraceSummary {
    trace_id: String,
    root_service: String,               // see "Root election" below
    root_name: String,
    root_status: SpanStatus,            // drives the status filter
    start_ns: u64,                      // min span start across the trace
    duration_ns: u64,                   // max span end − min span start (trace-level wall clock)
    span_count: u32,
    error_count: u32,
    services: Vec<String>,
}

struct TraceSummaryPage {
    items: Vec<TraceSummary>,
    total_scanned: u32,
    newest_file_age_ms: Option<u64>,
}

struct Trace {
    trace_id: String,
    spans: Vec<Span>,                   // flat — client builds the tree
    processes: HashMap<ProcessId, Process>,  // keyed by stable process ID, not service_name
    warnings: Vec<String>,
}

struct Process {
    process_id: ProcessId,              // stable hash of the full resource attribute set
    service_name: String,
    attributes: Vec<KeyValue>,          // full resource attributes (host, version, sdk, etc.)
}

// ProcessId = hex-encoded stable hash (e.g. blake3) of the normalized resource attribute set.
// Two spans share a ProcessId iff their ResourceSpans wrapper carried identical resource attrs.
// This preserves multi-instance distinctions (e.g. two pods of the same service hitting the
// same trace) that keying by service_name alone would collapse.
type ProcessId = String;

struct Span {
    span_id: String,
    parent_span_id: Option<String>,
    trace_id: String,
    operation_name: String,
    service_name: String,               // convenience duplicate of process.service_name
    process_id: ProcessId,              // resolves the span back to its Process in the map
    start_ns: u64,
    duration_ns: u64,
    status: SpanStatus,                 // ok | error | unset
    kind: SpanKind,
    attributes: Vec<KeyValue>,
    events: Vec<SpanEvent>,
    links: Vec<SpanLink>,
    flags: u32,
}
```

### Error semantics

`TelemetryError` serializes to a tagged string (`"collector_not_running"`, `"dir_missing"`, `"trace_not_found"`, `"io: …"`) that matches the repo's existing Tauri-command error style. The UI maps the tag to the right empty-state banner.

### Reuse of existing code

- `TelemetryStore::open_at(dir)` is used unchanged.
- `telemetry_get_trace` reuses the file-scan and trace-assembly path that the existing `--trace-id` CLI command uses (returning a fully-assembled trace after span-level filtering).
- The span-row parsing and resource-attribute extraction in `query.rs` are reused; new logic is built on top.

### New Rust code (more than thin wiring)

- **Trace-summary aggregation.** The existing `query.rs` path emits flat `TraceRow`s with only span-level filters (`from/to/name/service/trace_id/attrs/limit`). `telemetry_search_traces` is **not** a thin wrapper — it adds a new aggregation pass that:
  1. Scans spans within a wider-than-requested window (see trace-level filter note below).
  2. Groups by `trace_id`.
  3. Elects a root per trace (see "Root election").
  4. Computes `span_count`, `error_count`, `services[]`, trace-level `start_ns` / `duration_ns`.
  5. Applies **trace-level** filters (`min_duration_ns` / `max_duration_ns`, multi-service, `status`) that cannot be evaluated at the span-row level.
  6. Applies `limit` last.
- **Root election.** Explicit rule, applied deterministically so the search result is stable across scans:
  1. If exactly one span has `parent_span_id == None`, that is the root.
  2. If multiple spans have no parent (multi-root trace), pick the one with the smallest `start_ns`; on tie, the smallest `span_id` lexicographically.
  3. If no span has `parent_span_id == None` (all parents present but some reference spans we never saw — e.g., trace crosses the scan window), pick the earliest span whose parent is not in the set ("orphan root"); tie-break as above.
  4. The elected root determines `root_service`, `root_name`, `root_status`. `TraceSummary` always has exactly one root.
  5. The trace-detail view's synthetic `(orphans)` grouping is a separate rendering concern and does not affect summary root election.
- **Trace-level window semantics.** A trace's root span may fall outside the user's `from`/`to` window while child spans fall inside. To keep filters intuitive ("show me traces active in the last hour"), the summary scan uses a widened window internally (up to ~24h before `from`) to find the root span of any trace with activity in the user-requested window. This widening is a backend implementation detail, not a UI knob.
- **`telemetry_list_services`** — new ~30-line helper walking the same file set and extracting distinct `service.name` resource attributes in the window.
- **`TraceFilter` extensions** — see "Required backend changes" above.
- **`Process` / `ProcessId` derivation** — OTLP JSON has no "process" concept; resource attributes live on `ResourceSpans`. For each trace, compute a `ProcessId` per distinct resource-attribute set (stable hash over the normalized attrs), emit one `Process` per `ProcessId`, and tag every `Span` with its `ProcessId`. This preserves multi-instance distinctions that keying by `service_name` would lose.
- **`newest_file_age_ms` computation** — derived from filesystem mtime of the newest file in the collector directory, not from the filename's rotation timestamp. The active file is `otlp.json`, whose filename carries no timestamp; mtime is the only reliable "is the collector actively writing" signal.

## Frontend structure

```
packages/desktop-app/src/features/traces/
├── routes/
│   ├── traces.tsx                       # /traces
│   └── trace-detail.tsx                 # /traces/$traceId
│   (plus sidebar link added to features/desktop-shell/app-shell.tsx)
├── search/
│   ├── search-page.tsx
│   ├── trace-filters.tsx
│   ├── trace-results-list.tsx           # virtualized (@tanstack/react-virtual)
│   ├── duration-bar.tsx
│   └── use-search-traces.ts
├── trace/
│   ├── trace-detail-page.tsx
│   ├── trace-header.tsx
│   ├── tabs/
│   │   ├── timeline/
│   │   │   ├── timeline-view.tsx
│   │   │   ├── timeline-header.tsx
│   │   │   ├── span-row.tsx
│   │   │   ├── span-bar.tsx
│   │   │   ├── span-detail-panel.tsx
│   │   │   ├── use-timeline-layout.ts
│   │   │   └── use-timeline-controls.ts
│   │   ├── stats/
│   │   │   ├── stats-view.tsx
│   │   │   └── use-trace-stats.ts
│   │   ├── critical-path/
│   │   │   ├── critical-path-view.tsx
│   │   │   └── compute-critical-path.ts
│   │   ├── spans/
│   │   │   └── spans-table.tsx
│   │   └── json/
│   │       └── json-view.tsx
│   └── use-get-trace.ts
├── shared/
│   ├── service-color.ts
│   ├── format-duration.ts
│   └── types.ts                         # TS mirror of Rust DTOs
└── __fixtures__/
    ├── small-trace.json              # ~10 spans, one service
    ├── multi-service-trace.json      # 3 services, cross-process, includes events
    ├── orphan-trace.json             # missing parent → synthetic root
    ├── skew-trace.json               # child starts before parent
    └── attr-heavy-trace.json         # HTTP spans with http.method, http.status_code, etc.
                                      # drives the attr filter and attr search tests
```

### Component boundaries

- **Timeline viewer** is the only expensive piece. `use-timeline-layout.ts` owns the transform from flat `Span[]` → displayable rows with collapse state. `span-row.tsx` / `span-bar.tsx` stay presentational. Virtualized to stay smooth on 10k-span traces.
- **Critical path reuses timeline rendering.** `critical-path-view.tsx` runs `compute-critical-path.ts` to mark spans, then passes the same row model to timeline components with a "dim non-critical" prop. No second rendering pipeline.
- **Stats is a pure function over the loaded trace.** No extra backend call; tab switches are instant.
- **Spans table and JSON view** are trivial and free once the trace is loaded — included because users will always want them.

### Cross-cutting pieces (dependencies of this work)

- **`RefreshPicker` + `useAutoRefresh` — non-trivial refactor.** The web app's `useAutoRefresh` hard-codes `useSearch({ from: "/_authenticated/_dashboard" })`, coupling it to one route. This work must refactor it — e.g. take the refresh interval as a hook parameter and accept an `onTick` / `onRefresh` callback rather than invalidating all queries — so it works from both the web app dashboard and the desktop `/traces` route. Both call sites get updated. **Flag: this is a dependency, not an incidental extraction.**
- **Time-range picker.** Reuse `TimeRangePicker` from `@everr/ui/components/time-range-picker` (already shippable, already used by `features/notifications/notifications-page.tsx`). No lift required.
- **Service colors — theme-aware.** One stable-hash function shared by search service chips and timeline rows so a given service always gets the same color across views. The desktop app today is single-themed (dark, via Radix Themes + custom CSS vars in `src/styles/desktop-app.css`), but the color palette must come from CSS variables rather than hard-coded hex so a future light theme does not require rewriting every view.
- **`@tanstack/react-virtual` dependency.** Not currently in the desktop app's `package.json`. Added as part of this work for the virtualized results list and potentially for timeline row virtualization.

### Navigation and placement

The `/traces` route is added as a new sidebar link in `features/desktop-shell/app-shell.tsx` — always visible in all environments (not gated behind `import.meta.env.DEV` like the `/developer` link). The telemetry sidecar starts with the desktop app, so the route is always reachable; "collector not running" is handled as an in-page empty state, not by hiding the nav entry.

### Deliberately absent

- No Redux, no global state. URL + TanStack Query is the state model.
- No custom drag-to-pan physics in MVP. Keyboard + wheel zoom + click-drag on the axis to select a range is enough; revisit if it feels off.
- No cursor pagination. A `limit` param with a "load more" button (increasing `limit`) covers MVP. Because files rotate and the backend has no stable cross-scan ordering, "load more" results are **best-effort** — second-page results can overlap with first-page results if rotation occurred between scans. Documented in-UI ("results may shift as new traces arrive"), revisited if it becomes a practical annoyance.

## Data flow

1. User lands on `/traces`. URL search params default to `from=now-1h&to=now&refresh=off`.
2. `use-search-traces.ts` reads the URL and builds a TanStack Query keyed on the **raw datemath expressions** (`from`, `to`) plus other filter params. The fetcher itself calls `resolve()` from `@everr/datemath` to get absolute ns at query time, then invokes `telemetry_search_traces`. **Rationale:** keying on resolved ns turns `now-1h` / `now` into a moving key, causing refetches on every render and defeating cache stability. This matches the desktop app's existing pattern in `features/notifications/notifications-page.tsx` (raw strings in key, resolve in fetcher).
3. `useAutoRefresh(refresh, () => queryClient.invalidateQueries({ queryKey: tracesSearchQueryKey }))` re-runs the search query on its interval if `refresh !== 'off'`. Each invalidation re-resolves datemath, so a fresh `now` slides forward naturally.
4. Clicking a row navigates to `/traces/$traceId?tab=timeline`. `use-get-trace.ts` runs a TanStack Query keyed on `traceId` plus the search page's active `refresh` interval, calling `invoke('telemetry_get_trace', id)`.
5. **Trace detail handles in-progress traces.** `otlp.json` is the actively-written current file, so a trace opened while its emitting service is still running can grow between loads. The detail page **inherits the search page's `refresh` interval** (passed via URL): if search was set to auto-refresh every 15s, detail refetches on the same cadence. When a refetch returns the same span count and max-end-time as the previous fetch, the UI does not re-render the timeline (equality check on a cheap trace-shape hash). When `refresh=off`, the detail page still surfaces a "refresh" button in the header — users who opened a detail page without setting a search-page interval can still pull new spans. Traces are not inherently immutable; the collector may still be appending.

## Error handling and edge cases

### Search page states

| State | Trigger | UI |
|-------|---------|----|
| No collector dir | `dir_missing` | Banner: "Telemetry collector hasn't started yet. It starts with the desktop app." + retry button. |
| Collector idle | `newest_file_age_ms > 5 min` (reuses existing `STALE_SIBLING_THRESHOLD` of 300s) | Soft warning above results; results still render. |
| No results | Zero rows, collector fresh | Empty state with quick actions: widen to `now-24h`, clear filters. |
| Backend error | `io: …` | Inline error card + retry. |

### Trace detail states

| State | Trigger | UI |
|-------|---------|----|
| Trace not found | `trace_not_found` | "This trace is no longer on disk. The collector rotates files over time." + link back to search. |
| Partial trace | Backend returns `warnings: [...]` | Non-blocking banner listing warnings. Timeline renders; orphans go under a synthetic root. |
| Empty trace | 0 spans | "This trace contains no spans" empty state. |

### Tricky data handled in `use-timeline-layout.ts`

- **Clock skew:** child span `start_ns` before parent's — clamp *visually* to parent start and render a skew badge (a small icon + tooltip "clock skew: child started N ms before parent") inline with the span name. Do not reorder spans, and do not mutate timestamps in the underlying data. Stats tab uses the **original unclamped `duration_ns`**; the clamping is purely a rendering concern for the Gantt view.
- **Zero-duration spans:** render as a 1 px tick, still selectable.
- **Very long traces (>10k spans):** virtualized list, collapse-all button, stats tab as the escape hatch.
- **Orphan spans (missing parent):** group under a synthetic root labeled "(orphans)". Critical-path computation excludes this synthetic root from propagation.

### Cross-cutting

- **Cache invalidation:** `useAutoRefresh` invalidates both the search query and the active trace-detail query (if any). Trace-detail is **not** immutable — see "Data flow" step 5 for the in-progress-trace story. A cheap hash of the `Trace` (span count + max end-time + warnings length) is compared across refetches; timeline re-renders are skipped when nothing changed.
- **Concurrent file rotation:** handled by `store.rs` today; no frontend work.
- **Deep-link to rotated-out trace:** the "trace not found" state covers it. This is the expected long-term outcome for every trace.
- **No network retries:** local IPC calls fail fast, show the error, let the user retry explicitly.

## Testing

### Rust side

- Unit tests on the `TraceSummary` aggregation helper using existing OTLP JSON fixtures plus new fixtures for missing-parent, zero-duration, and clock-skew cases.
- One smoke test per Tauri command: happy path + one error path (`dir_missing` for search, `trace_not_found` for get-trace).
- No filesystem mocks — tests point `TelemetryStore::open_at` at a temp dir populated from fixtures, matching the pattern in `crates/everr-core` and the CLI tests.

### Frontend side

- **Pure-function tests (vitest)** for the logic modules:
  - `compute-critical-path.ts` — simple chain, siblings with different durations, orphans excluded, single-span trace.
  - `use-trace-stats.ts` — grouping by operation/service/tag, percentile math, "% of trace" sums to ≤ 100.
  - `use-timeline-layout.ts` — flat → ordered rows, collapse state, clock-skew clamping.
  - `service-color.ts` — stable across renders and across search + timeline views.
  - `format-duration.ts` — ns → human string at each scale boundary.
- **Component tests (React Testing Library):**
  - `trace-results-list` — N rows render, duration-bar widths, click navigates (router mock).
  - `timeline-view` — load fixture, expand/collapse subtree, select a span → detail panel shows attributes.
  - `stats-view` — switch group-by, sort by p95, verify order.
  - `critical-path-view` — fixture's marked spans match the pure-fn test expectations.
- **Empty-state tests:** render each banner/empty state from its backend error tag.

### Out of scope for MVP testing

- End-to-end Tauri tests.
- Performance benchmarks.
- Snapshot tests for timeline markup (rot with every style change).

## Resolved architectural decisions

### Shared telemetry DTO crate

The Rust DTOs used by Tauri commands (and by the CLI, once `TraceFilter` is extended) live in a **new workspace crate**, `crates/everr-telemetry-dto` (name TBD in implementation), rather than being added as a `pub` module on the existing CLI telemetry crate. Rationale:

- The Tauri binary should not transitively depend on CLI-only dependencies (argument parsing, terminal rendering).
- Keeps compile times predictable as both call sites grow.
- Matches the pattern already used for `@everr/datemath` etc. — small, focused crates over monolithic ones.

The existing CLI telemetry modules (`store.rs`, `query.rs`, `otlp.rs`) remain where they are. The new crate holds the serde-facing DTOs and the aggregation helpers shared between CLI and Tauri.

### TimeRangePicker

Reuse `@everr/ui/components/time-range-picker`'s existing `TimeRangePicker`, which is already used by the desktop app's notifications page. No new work required for the picker itself; `useAutoRefresh` is the only refactor listed under "Cross-cutting pieces".
