# Writing Everr Dashboards

An Everr dashboard is a Perses-style YAML or JSON file, named `<slug>.dashboard.yaml` in the apply tree. Read `rules/queries.md` first for the panel, query, and variable model; this file covers the dashboard-specific schema.

## Dashboard spec quick reference

```yaml
kind: Dashboard
metadata:
  name: <slug>               # required; lowercase letters/digits/hyphens, 1–200 chars, the URL segment
  project: platform          # optional; defaults to "default"; namespaces identity + URL
spec:
  display: { name: ..., description: ... }   # optional
  duration: 1h               # optional; seeds the time-range picker (e.g. 1h, 24h)
  refreshInterval: 30s       # optional; seeds auto-refresh
  variables: [ ... ]         # optional; see rules/queries.md
  panels: { <key>: Panel }   # required; map of panel key -> panel (see rules/queries.md)
  layouts: [ Grid ]          # required; places panels on a 24-column grid
```

Identity is `project` + `slug` → URL `/dashboards/<project>/<slug>`.

## Layout — panels only render if a layout references them

```yaml
layouts:
  - kind: Grid
    spec:
      items:
        - { x: 0,  y: 0, width: 12, height: 8, content: { $ref: "#/spec/panels/error-rate" } }
        - { x: 12, y: 0, width: 12, height: 8, content: { $ref: "#/spec/panels/latency" } }
```

`content.$ref` is always `#/spec/panels/<panel-key>`. Grid is 24 columns wide; `x`/`y` are cells, `width`/`height` are spans.

## Complete worked example

`everr/checkout-api.dashboard.yaml`:

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
                    SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
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

> The column names above (`ServiceName`, `SpanName`, `Duration`, `StatusCode`) are the standard `traces` columns. If you query attributes (`SpanAttributes['http.route']`, etc.) or other tables, discover the real columns first — see Startup Access in the skill root.

## Common mistakes

| Mistake | Fix |
| --- | --- |
| Panel defined but not on the grid | A panel renders only if a `layouts` item `$ref`s it. |
| Hard-coded `toStartOfMinute` on a chart viewable over days | Bucket with `INTERVAL {step:UInt32} SECOND` — see `rules/queries.md`. |
