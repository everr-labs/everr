# Multiple queries per panel

## Goal

Bring panels to full Perses parity for the `queries` array: a single panel can run
several queries, and every layer — execution, editor, and visualization — honours
all of them instead of only `queries[0]`.

The Perses data model already stores `panel.spec.queries` as an array
(`packages/app/src/data/dashboards/schema.ts:50`). Today the schema is the only
layer that is array-aware; the editor, query execution, and all three
visualizations assume `queries[0]`. This is the documented v1 limitation in
`DASHBOARD_FEATURES.md:47`.

## Non-goals (YAGNI)

- Transforms / joins / merges across query results (Grafana-style transformations).
- Per-query datasource selection or query plugin kinds other than `ClickHouseSQL`.
- Per-query legend naming or series-name overrides.
- Partial-failure rendering — see "Error handling" below.

## Decisions

| Question | Decision |
| --- | --- |
| How results combine in a viz | Per-query result sets: each viz receives an array of result sets and decides how to combine. |
| Editor UX | Stacked editors — each query has its own labelled SQL editor, Run, and remove control, plus "Add query". |
| Partial failure | Whole-panel error: if any query errors or has an unresolved variable, the panel shows the error state. |
| Execution | Parallel via TanStack `useQueries`, reusing the existing per-query `panelQueryOptions` cache. No batch server fn. |
| Table with N queries | One frame at a time with a query selector (mirrors Grafana's default table behaviour). |
| Stat with N queries | One reduced tile per series across all queries (matches Grafana "Calculate" mode and Perses StatChart). |

## Architecture

### 1. Schema — no change

`panel.spec.queries: z.array(panelQuery).optional()` already models this. Persisted
dashboards and the settings JSON editor already round-trip multi-query arrays, so
existing data and hand-edited JSON keep working. The only change is downstream code
no longer indexing `[0]`.

### 2. Execution — `usePanelQueries` hook

`DashboardPanel` and `PanelEditPage` today each duplicate: resolve the single SQL,
compute its used variables, build `panelQueryOptions`, run `useQuery`. Extract a
shared hook:

```
usePanelQueries(panel, { from, to }) -> {
  data: QueryResultRow[][] | undefined,   // one result set per query, in order
  status: "pending" | "error" | "success",
  errorMessage: string | undefined,
}
```

- Resolves each query's SQL and computes that query's used variables independently
  (a query that uses no variables runs even if another query's variable is
  unresolved — variable resolution is per query).
- Builds an options array and runs `useQueries` (parallel, each entry reusing the
  existing `panelQueryOptions` so caching/dedup and the `runPanelQuery` server fn are
  unchanged).
- Combined status (whole-panel-error semantics):
  - `error` if **any** query errors **or** references a defined variable with no
    selected value; `errorMessage` is that query's message.
  - `pending` if any query is still pending and none has errored.
  - `success` only when all queries succeed; `data` is populated only then.

`DashboardPanel` replaces its inline `useQuery` block with this hook. The panel
status/error wiring stays the same, just sourced from the hook.

### 3. Editor — manual run + auto run, per query

`PanelEditPage` keeps the existing auto-run-saved / manual-run-draft split, now per
query:

- Auto preview: `usePanelQueries(panel, …)` over the **saved** panel (combined).
- Manual `Run` on a query primes that query's cache
  (`queryClient.setQueryData(panelQueryOptions(sql,…).queryKey, …)`); the combined
  preview reads from the same cache and updates. `handleRunQuery` takes the query's
  SQL (and resolves that query's variables) — unchanged logic, just parameterised by
  which query.
- Preview data passed to `PanelPreview` becomes `QueryResultRow[][]`.

`QueryEditor` becomes a list:

- One `SqlEditor` + Run + remove (trash) per query, with a query label
  ("Query A", "Query B", …) and "Add query" at the bottom.
- Add appends a `ClickHouseSQL` query; remove splices that index; both via `onChange`
  on the panel draft.
- Each row gets a **stable render-time id** (not persisted) used as its React key, so
  removing a middle query doesn't mis-associate the uncontrolled `SqlEditor`'s
  `defaultValue`. The id list lives in editor component state, kept in sync with the
  queries array length.

### 4. Visualization data contract

`VisualizationProps.data` changes from `QueryResultRow[]` to **`QueryResultRow[][]`**
(one result set per query, in query order). `PanelPreview` and `DashboardPanel` pass
the array straight through. Each visualization combines:

- **TimeSeriesChart** — process each result set into series using the existing pivot
  logic, then merge all series onto the shared time axis. Value keys are namespaced
  per query index so identical column names across queries don't collide; colours
  cycle sequentially across every series of every query. A single-query panel renders
  identically to today.

- **Table** — render one query's result set at a time. When there is more than one
  result set, show a small selector (e.g. segmented control / tabs labelled
  "Query A…") to switch which frame is displayed; default to the first. A single-query
  panel shows no selector and looks exactly like today.

- **StatChart** — render one tile per series across all result sets, each reduced via
  the panel's `calculation`. Tiles lay out in a flex row/grid. A single query
  returning one value renders identically to today; a query (or queries) yielding
  multiple series now produces multiple tiles (intended improvement — today only the
  first series is shown).

### 5. Error handling

Whole-panel error (see status table). No partial render and no per-query warning
badge in this iteration. Empty results from all queries fall through to each viz's
existing empty state.

## Affected files

- `packages/app/src/data/dashboards/options.ts` — unchanged (`panelQueryOptions` reused).
- `packages/app/src/data/dashboards/server.ts` — unchanged (`runPanelQuery` reused per query).
- `packages/app/src/components/dashboards/use-panel-queries.ts` — **new** shared hook.
- `packages/app/src/components/dashboards/dashboard-panel.tsx` — use the hook; drop `getPanelQuerySql`/inline `useQuery`.
- `packages/app/src/components/dashboards/panel-edit-page.tsx` — use the hook for preview; per-query manual run; pass `QueryResultRow[][]`.
- `packages/app/src/components/dashboards/query-editor.tsx` — stacked multi-query editor with add/remove and stable ids.
- `packages/app/src/components/dashboards/panel-preview.tsx` — `data?: QueryResultRow[][]`.
- `packages/app/src/components/dashboards/visualizations/index.tsx` — `data?: QueryResultRow[][]`.
- `packages/app/src/components/dashboards/visualizations/time-series-chart/time-series-chart-visualization.tsx` — merge series across queries.
- `packages/app/src/components/dashboards/visualizations/table/table-visualization.tsx` — query selector.
- `packages/app/src/components/dashboards/visualizations/stat-chart/stat-chart-visualization.tsx` — one tile per series.
- `DASHBOARD_FEATURES.md` — remove the single-query limitation note.

## Testing

- `usePanelQueries`: per-query variable resolution; combined status precedence
  (error > pending > success); `data` only when all succeed; order preserved.
- TimeSeriesChart: two queries with colliding column names produce distinct,
  correctly-coloured series merged on one axis; single query unchanged.
- Table: selector appears only with >1 query; switching changes the displayed frame;
  single query unchanged.
- StatChart: N series across queries → N tiles, each reduced; single value unchanged.
- QueryEditor: add/remove queries; removing a middle query keeps the remaining
  editors' contents associated correctly.
- Browser verification of a real multi-query panel per the verifying-everr-app memory.
