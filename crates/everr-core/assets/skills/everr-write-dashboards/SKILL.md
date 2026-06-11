---
name: everr-write-dashboards
description: Use when creating, editing, or applying an Everr dashboard as code — Perses-format dashboard YAML/JSON files, panels, ClickHouse queries, dashboard variables, grid layouts, the everr.yaml manifest, or the `everr apply` CLI.
---

## Startup Access

Writing dashboards is just editing files. Two things need access:

- **`everr apply`** talks to your Everr host. Allow production network `https://app.everr.dev` and filesystem read of `~/Library/Application Support/everr/session.json` (and `session-dev.json`) and their parent directory. Apply uses your `everr cloud login` session, or `EVERR_API_TOKEN` for CI.
- **Writing correct queries** means knowing your real ClickHouse columns. Discover them with `everr cloud query "DESCRIBE TABLE traces"` (or sample rows), or use the `everr-use-telemetry` skill. **Do not invent metric/label names.**

# Writing Everr Dashboards

Everr dashboards are **as-code**: a Perses-style YAML or JSON file on disk, reconciled into Everr with `everr apply`. The file is the source of truth.

## The model is Perses, but the engine is ClickHouse

The file format mirrors [Perses](https://perses.dev), so the structure (`kind`/`metadata`/`spec`, `panels` map, `layouts` grid, `$ref` pointers) is standard Perses. **But the four things below are Everr-specific — stock Perses/Grafana knowledge gets them wrong:**

1. **Queries are ClickHouse SQL, not PromQL.** The only query plugin is `ClickHouseSQL`. No Prometheus, no `rate()`, no `$__rate_interval`, no `PrometheusTimeSeriesQuery`.
2. **Time range is two SQL params:** `{from:String}` and `{to:String}`. You must put them in your `WHERE`. There is no auto-injection.
3. **Visualizations are five kinds with simple specs:** `TimeSeriesChart`, `BarChart`, `Table`, `StatChart`, `GeoMap`. They infer structure from the columns you `SELECT` — there is no `yAxis`, `legend`, `columnSettings`, `format.unit`, etc.
4. **Variable options come from `StaticListVariable` or `ClickHouseSQLVariable` only** — not `PrometheusLabelValuesVariable`. `$name` interpolates to a quoted ClickHouse literal.

## File layout and the required manifest

`everr apply <dir>` reconciles a directory. The directory **must** contain an `everr.yaml` (or `.yml`) at its root declaring the projects it manages — apply errors without it. There is no implicit `default`.

```
dashboards/
  everr.yaml                 # REQUIRED manifest — declares the reconcile scope
  api-latency.yaml           # root folder
  platform/
    db-health.yaml           # folder "platform" (from the directory name)
```

`dashboards/everr.yaml`:

```yaml
projects:
  - default
  - platform
```

Every dashboard's `metadata.project` (or `default` when omitted) **must** appear in this list, or apply rejects it. Folders in the UI come from the directory tree — there are no folder objects.

## Dashboard spec quick reference

```yaml
kind: Dashboard
metadata:
  name: <slug>               # required; lowercase letters/digits/hyphens, 1–200 chars, the URL segment
  project: platform          # optional; defaults to "default"; must be in everr.yaml
spec:
  display: { name: ..., description: ... }   # optional
  duration: 1h               # optional; seeds the time-range picker (e.g. 1h, 24h)
  refreshInterval: 30s       # optional; seeds auto-refresh
  variables: [ ... ]         # optional; see Variables
  panels: { <key>: Panel }   # required; map of panel key -> panel
  layouts: [ Grid ]          # required; places panels on a 24-column grid
```

Identity is `project` + `slug` → URL `/dashboards/<project>/<slug>`.

### Panel

```yaml
panels:
  error-rate:                            # panel key — referenced by the layout's $ref
    kind: Panel
    spec:
      display: { name: Error rate }      # description optional
      plugin:
        kind: TimeSeriesChart            # TimeSeriesChart | BarChart | Table | StatChart | GeoMap
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

The double `ClickHouseSQL` (query `kind` **and** inner `plugin.kind`) is required, not a typo. Multiple queries are allowed: time-series and bar charts overlay them on one axis, table shows a selector, stat renders one tile per series, geo-map overlays markers (points) or merges regions (choropleth). The panel `plugin.kind` is one of `TimeSeriesChart`, `BarChart`, `Table`, `StatChart`, `GeoMap` — see [Visualization options](#visualization-options) for each kind's `spec`.

### Layout — panels only render if a layout references them

```yaml
layouts:
  - kind: Grid
    spec:
      items:
        - { x: 0,  y: 0, width: 12, height: 8, content: { $ref: "#/spec/panels/error-rate" } }
        - { x: 12, y: 0, width: 12, height: 8, content: { $ref: "#/spec/panels/latency" } }
```

`content.$ref` is always `#/spec/panels/<panel-key>`. Grid is 24 columns wide; `x`/`y` are cells, `width`/`height` are spans.

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
| `GeoMap` | points mode: numeric lat/lon columns (+ optional value/label); choropleth mode: an ISO-3166 alpha-2/alpha-3 country-code column + a numeric value column (see `rules/geomap.md`). No time axis. |

## Visualization options

Each visualization has its own option set and behaviors. **Load the rule file for the visualization you're using** before writing its `spec` — each file lists the *complete* set of options, the exact data shape it expects, and its footguns. Anything not listed there does not exist; do not invent options.

| Visualization | Rule | Load when you need |
| --- | --- | --- |
| `TimeSeriesChart` | `rules/timeseries.md` | a line or stacked area chart over time — units, legend, curve, gaps, stacking, per-series breakdown |
| `BarChart` | `rules/barchart.md` | bars over time or categories — stacking, percent mode, orientation, value labels |
| `Table` | `rules/table.md` | a row/column table — sticky header, column formatting (SQL-side) |
| `StatChart` | `rules/statchart.md` | big single-value tiles — calculations, sparklines, threshold coloring |
| `GeoMap` | `rules/geomap.md` | a world map — lat/lon markers or country shading, aggregation, color/size scales |

## Variables

Define under `spec.variables`; reference in SQL with `$name`. Everr interpolates **server-side** before running the query.

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

## Complete worked example

`dashboards/everr.yaml`:

```yaml
projects:
  - demo
```

`dashboards/checkout-api.yaml`:

```yaml
kind: Dashboard
metadata:
  name: checkout-api
  project: demo
spec:
  display:
    name: Checkout API
  duration: 1h
  refreshInterval: 30s
  variables:
    - kind: ListVariable
      spec:
        name: service
        display: { name: Service }
        allowMultiple: true
        allowAllValue: true
        sort: alphabetical-asc
        plugin:
          kind: ClickHouseSQLVariable
          spec:
            query: SELECT DISTINCT ServiceName FROM traces ORDER BY ServiceName
  panels:
    p95-latency:
      kind: Panel
      spec:
        display: { name: p95 request latency (ms) }
        plugin:
          kind: TimeSeriesChart
          spec: { unit: ms, showLegend: true }
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin:
                kind: ClickHouseSQL
                spec:
                  query: |
                    SELECT toStartOfMinute(Timestamp) AS ts,
                           quantile(0.95)(Duration) / 1e6 AS p95_ms
                    FROM traces
                    WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                      AND ServiceName IN $service
                    GROUP BY ts
                    ORDER BY ts
    error-rate:
      kind: Panel
      spec:
        display: { name: Error rate }
        plugin:
          kind: StatChart
          spec:
            calculation: last
            unit: "%"
            thresholds:
              mode: absolute
              defaultColor: "#22c55e"
              steps:
                - { value: 1, color: "#f59e0b" }
                - { value: 5, color: "#ef4444" }
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin:
                kind: ClickHouseSQL
                spec:
                  query: |
                    SELECT countIf(StatusCode = 'Error') / count() * 100 AS error_pct
                    FROM traces
                    WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                      AND ServiceName IN $service
    slowest-endpoints:
      kind: Panel
      spec:
        display: { name: Top 10 slowest endpoints }
        plugin:
          kind: Table
          spec: { stickyHeader: true }
        queries:
          - kind: ClickHouseSQL
            spec:
              plugin:
                kind: ClickHouseSQL
                spec:
                  query: |
                    SELECT SpanName,
                           round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms,
                           count() AS spans
                    FROM traces
                    WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
                      AND ServiceName IN $service
                    GROUP BY SpanName
                    ORDER BY p95_ms DESC
                    LIMIT 10
  layouts:
    - kind: Grid
      spec:
        items:
          - { x: 0,  y: 0, width: 16, height: 8,  content: { $ref: "#/spec/panels/p95-latency" } }
          - { x: 16, y: 0, width: 8,  height: 8,  content: { $ref: "#/spec/panels/error-rate" } }
          - { x: 0,  y: 8, width: 24, height: 10, content: { $ref: "#/spec/panels/slowest-endpoints" } }
```

> The column names above (`ServiceName`, `SpanName`, `Duration`, `StatusCode`) are the standard `traces` columns. If you query attributes (`SpanAttributes['http.route']`, etc.) or other tables, discover the real columns first — see Startup Access.

## Apply workflow

```sh
everr apply ./dashboards --dry-run     # always preview first; writes nothing
everr apply ./dashboards               # prints the destination org, then asks to confirm
```

Apply is **declarative and delete-by-default within the declared projects**: new files are created, changed files updated, removed files **deleted**. Re-applying with no changes prints `Nothing to apply.` In CI, set `EVERR_API_TOKEN` and pass `--yes`.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| PromQL / `rate()` / `$__rate_interval` / `PrometheusTimeSeriesQuery` | Queries are **ClickHouse SQL**; the only query plugin is `ClickHouseSQL`. |
| Forgetting the `everr.yaml` manifest, or a `metadata.project` not listed in it | Every apply dir needs `everr.yaml` listing projects; each dashboard's project must be in it. |
| No `{from:String}`/`{to:String}` in the `WHERE` | Add `WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}` — it is not auto-injected. |
| Time-series x-axis blank | Alias the time column to `ts`/`time`/`timestamp`/… so it's detected. |
| Inventing viz options (`yAxis`, `legend`, `columnSettings`, `format.unit`, `calculation: last-number`, axis min/max) | Only the options in each viz's rule file (`rules/timeseries.md`, `rules/table.md`, `rules/statchart.md`, `rules/geomap.md`) exist. Format/round in SQL, not via spec. |
| `PrometheusLabelValuesVariable` or other variable plugins | Only `StaticListVariable` and `ClickHouseSQLVariable`. |
| Single `ClickHouseSQL` in the query block | Both the query `kind` and the inner `plugin.kind` are `ClickHouseSQL`. |
| `Duration` treated as ms/seconds | It's **nanoseconds** — divide by `1e6` (ms) or `1e9` (s). |
| Panel defined but not on the grid | A panel renders only if a `layouts` item `$ref`s it. |
| `everr dashboard apply -f file.yaml` | The command is `everr apply <dir>` against a directory, not a single file. |
| Inventing metric/label/column names | Discover real columns with `everr cloud query "DESCRIBE TABLE traces"` or the `everr-use-telemetry` skill. |
