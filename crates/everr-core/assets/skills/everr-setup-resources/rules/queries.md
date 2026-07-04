# Panels, Queries, And Variables

The panel/query/variable model is shared by dashboards and runbooks: a panel object inside a runbook **is** a dashboard panel, byte for byte.

## The model is Perses, but the engine is ClickHouse

The file format mirrors [Perses](https://perses.dev), so the structure (`kind`/`metadata`/`spec`, `panels` map, `$ref` pointers) is standard Perses. **But the four things below are Everr-specific — stock Perses/Grafana knowledge gets them wrong:**

1. **Queries are ClickHouse SQL, not PromQL.** The only query plugin is `ClickHouseSQL`. No Prometheus, no `rate()`, no `$__rate_interval`, no `PrometheusTimeSeriesQuery`.
2. **Time range is two SQL params:** `{from:String}` and `{to:String}`. You must put them in your `WHERE`. There is no auto-injection.
3. **Visualizations are eleven kinds with simple specs:** `TimeSeriesChart`, `BarChart`, `Table`, `StatChart`, `GaugeChart`, `GeoMap`, `Treemap`, `StateTimeline`, `StatusHistory`, `Heatmap`, `NodeGraph`. They infer structure from the columns you `SELECT` — there is no `yAxis`, `legend`, `columnSettings`, `format.unit`, etc.
4. **Variable options come from `StaticListVariable` or `ClickHouseSQLVariable` only** — not `PrometheusLabelValuesVariable`. `$name` interpolates to a quoted ClickHouse literal.

## Panel

```yaml
panels:
  error-rate:                            # panel key — referenced from a layout or ```panel ref
    kind: Panel
    spec:
      display: { name: Error rate }      # description optional
      plugin:
        kind: TimeSeriesChart            # TimeSeriesChart | BarChart | Table | StatChart | GaugeChart | GeoMap | Treemap | StateTimeline | StatusHistory | Heatmap | NodeGraph
        spec: { unit: "%", showLegend: true }
      queries:
        - kind: ClickHouseSQL            # outer query kind
          spec:
            plugin:
              kind: ClickHouseSQL        # inner plugin kind — yes, both say ClickHouseSQL
              spec:
                query: |
                  SELECT ...
```

The double `ClickHouseSQL` (query `kind` **and** inner `plugin.kind`) is required, not a typo. Multiple queries are allowed: time-series and bar charts overlay them on one axis, table shows a selector, stat renders one tile per series, gauge renders one gauge per series, geo-map overlays markers (points) or merges regions (choropleth), treemap colors tiles per query, state-timeline and status-history accumulate lanes across queries, heatmap sums cells across queries, node-graph merges edges across queries.

## Writing the SQL

Every panel query runs against your ClickHouse telemetry tables (`traces`, `logs`, `metrics_*`). Three rules:

- **Scope to the picker.** Always include `WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}`. Omitting it scans all history and stops following the time picker (Table/Stat aggregate everything).
- **Alias the time column** for time-series x-axis. It's detected by exact name (case-insensitive) — alias to one of: `ts`, `time`, `timestamp`.
- **`Duration` is nanoseconds.** Divide by `1e6` for ms, `1e9` for seconds. `StatusCode = 'Error'` for failed spans.
- **Bucket time-series adaptively** (see below) — never hard-code `toStartOfMinute` for a chart that can be viewed over days.

### Bucketing time-series

`toStartOfMinute(Timestamp)` is fine for a 1-hour view but produces ~10k points per series over 7 days — slow and unreadable. Everr supplies a third parameter, **`{step:UInt32}`** — the adaptive bucket width in **seconds**, computed server-side from the selected range (snapped to a clean clock interval, ~500 points). Bucket time-series with it instead of a fixed `toStartOfMinute`:

```sql
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       count() AS spans
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts
ORDER BY ts
```

`{step}` tracks the time picker automatically: ~10s buckets at 1h, ~30m at 7d, always ~500 points. Use the **same** `INTERVAL {step:UInt32} SECOND` on the metrics tables' `TimeUnix` column. Keep `toStartOfMinute`/`toStartOfHour` only for a chart pinned to a short, fixed range. (Tables and time-less Stat panels don't bucket — they aggregate; a Stat sparkline benefits, though.)

Data shape per visualization (the viz infers everything from your columns):

| Viz | Return |
| --- | --- |
| `TimeSeriesChart` | a time column (aliased above) + numeric series columns. A non-numeric **string** column pivots one value column into one line per label (e.g. `GROUP BY ts, ServiceName`) — but **only with exactly one numeric column** (see `rules/timeseries.md`). |
| `BarChart` | same as `TimeSeriesChart` (time column + numeric series, string pivot with exactly one numeric column) — or, **without** a time column, the first string column becomes the category axis (see `rules/barchart.md`). |
| `Table` | any columns, rendered as-is in query order (no formatting — do it in SQL). |
| `StatChart` | one or more numeric columns — **one tile per numeric column** (each reduced by `calculation`). A string column creates no tile. Include a time column for per-tile sparklines. |
| `GaugeChart` | same shape as `StatChart` — one gauge per numeric column, reduced by `calculation`. Pick the gauge's `min`/`max` in the spec; no time axis needed. |
| `GeoMap` | points mode: numeric lat/lon columns (+ optional value/label); choropleth mode: an ISO-3166 alpha-2/alpha-3 country-code column + a numeric value column (see `rules/geomap.md`). No time axis. |
| `Treemap` | a label column + a **positive** numeric column (tile area), optionally a group column for color (see `rules/treemap.md`). No time axis; always `LIMIT`. |
| `StateTimeline` | a time column (aliased above) + state columns — **one lane per non-time column**, cell value = state. For `GROUP BY` rows set `seriesColumn`/`stateColumn` in the spec to pivot one lane per label (see `rules/statetimeline.md`). |
| `StatusHistory` | same shapes as `StateTimeline`, but each sample is an **independent cell** — nothing holds until the next sample; missing samples stay visibly empty (see `rules/statushistory.md`). |
| `Heatmap` | a time column (aliased above) + a bucket column (y-axis) + a numeric value column (cell color) — `GROUP BY` time and bucket; same-cell rows sum (see `rules/heatmap.md`). |
| `NodeGraph` | an edge list: a source column + a target column + an optional numeric weight column (see `rules/nodegraph.md`). No time axis; always `LIMIT`. |

## Visualization options

Each visualization has its own option set and behaviors. **Load the rule file for the visualization you're using** before writing its `spec` — each file lists the *complete* set of options, the exact data shape it expects, and its footguns. Anything not listed there does not exist; do not invent options.

| Visualization | Rule | Load when you need |
| --- | --- | --- |
| `TimeSeriesChart` | `rules/timeseries.md` | a line or stacked area chart over time — units, legend, curve, gaps, stacking, per-series breakdown |
| `BarChart` | `rules/barchart.md` | bars over time or categories — stacking, percent mode, orientation, value labels |
| `Table` | `rules/table.md` | a row/column table — sticky header, column formatting (SQL-side) |
| `StatChart` | `rules/statchart.md` | big single-value tiles — calculations, sparklines, threshold coloring |
| `GaugeChart` | `rules/gaugechart.md` | a value on a min→max arc — bounds, calculations, threshold bands |
| `GeoMap` | `rules/geomap.md` | a world map — lat/lon markers or country shading, aggregation, color/size scales |
| `Treemap` | `rules/treemap.md` | proportional-area tiles — part-of-whole breakdowns, grouping/colors, value labels |
| `StateTimeline` | `rules/statetimeline.md` | discrete states over time — health/status lanes, state colors, merging, gaps |
| `StatusHistory` | `rules/statushistory.md` | one cell per periodic check/run — probe results, cron outcomes, missing-sample visibility |
| `Heatmap` | `rules/heatmap.md` | a time × bucket density grid — histograms over time, color ramps, scale curves |
| `NodeGraph` | `rules/nodegraph.md` | a directed node/edge graph — service maps, call graphs, edge weights, arrows |

## Test every query before applying

Run every panel query with `everr cloud query` before applying, substituting concrete values for `{from:String}`, `{to:String}`, and `{step:UInt32}`. Test each query over several time ranges — at least a short one (1h) and a long one (7d or 30d) — because a query that behaves at 1h can explode at 7d.

On every range, the result must stay **far below 1,000 rows**. If it gets anywhere close, the query is wrong for a panel: tighten the bucketing (use `{step:UInt32}`), aggregate harder, or add a `LIMIT`. High-cardinality pivots (a `GROUP BY ts, SomeLabel` with many label values) are the usual culprit.

## Variables

Define under `spec.variables` (same schema in dashboards and runbooks); reference in SQL with `$name`. Everr interpolates **server-side** before running the query.

```yaml
variables:
  - kind: ListVariable
    spec:
      name: service
      display: { name: Service }
      allowMultiple: true        # optional
      allowAllValue: true        # optional; adds "All"
      sort: alphabetical-asc     # optional
      plugin:
        kind: ClickHouseSQLVariable          # or StaticListVariable
        spec:
          query: SELECT DISTINCT ServiceName FROM traces ORDER BY ServiceName
          # values: [a, b]       # for StaticListVariable instead of query
  - kind: TextVariable
    spec:
      name: search
      value: ""                  # default; constant: true makes it a fixed, hidden value
```

Interpolation tokens:

| Token | Expands to |
| --- | --- |
| `$name` | a ClickHouse literal — `'api'`, or a list `('api','web')` for multi-select (empty → `(NULL)`) |
| `${name}` | same, with explicit delimiters for embedding (`pre${name}post`) |
| `${name:raw}` | **unquoted**, comma-joined for lists — only for trusted, non-string fragments |

```sql
WHERE ServiceName IN $service        -- ('api','web')
  AND Environment = $env             -- 'prod'
```

For `allowAllValue`, "All" expands to every loaded option as a quoted list; set `customAllValue` (inserted verbatim, quote it yourself, e.g. `"'%'"`) for a fixed substitution. **Not supported** (accepted but inert): variable chaining, `capturingRegexp`, per-panel overrides, variables in titles.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| PromQL / `rate()` / `$__rate_interval` / `PrometheusTimeSeriesQuery` | Queries are **ClickHouse SQL**; the only query plugin is `ClickHouseSQL`. |
| No `{from:String}`/`{to:String}` in the `WHERE` | Add `WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}` — it is not auto-injected. |
| Time-series x-axis blank | Alias the time column to `ts`/`time`/`timestamp` so it's detected. |
| Inventing viz options (`yAxis`, `legend`, `columnSettings`, `format.unit`, `calculation: last-number`, axis min/max) | Only the options in each viz's rule file exist. Format/round in SQL, not via spec. |
| `PrometheusLabelValuesVariable` or other variable plugins | Only `StaticListVariable` and `ClickHouseSQLVariable`. |
| Single `ClickHouseSQL` in the query block | Both the query `kind` and the inner `plugin.kind` are `ClickHouseSQL`. |
| `Duration` treated as ms/seconds | It's **nanoseconds** — divide by `1e6` (ms) or `1e9` (s). |
| Applying without running the queries | Test every query with `everr cloud query` over both a short and a long time range. |
| Result sets approaching 1,000 rows on any range | Bucket with `{step:UInt32}`, aggregate harder, or `LIMIT` — panels must stay far below 1k rows. |
