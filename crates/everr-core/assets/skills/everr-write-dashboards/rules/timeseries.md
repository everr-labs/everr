# TimeSeriesChart

A line chart over time. It infers its structure from the columns you `SELECT` — there is no axis, color, stacking, or area configuration.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `unit` | string | `""` | any string | Suffix on y-axis ticks and tooltip values. Raw concatenation, **no space** — `unit: ms` renders `123ms`. |
| `showLegend` | boolean | `false` | `true` | Show the series legend. Only the literal `true` enables it. |
| `lineWidth` | number | `1.5` | any number | Line stroke width. |
| `curveType` | string | `monotone` | `monotone`, `linear`, `natural`, `stepBefore`, `stepAfter` | Line interpolation. An unknown value falls back to the renderer default. |
| `connectNulls` | boolean | `false` | `true` | Bridge gaps instead of breaking the line at them. |

```yaml
plugin:
  kind: TimeSeriesChart
  spec: { unit: ms, showLegend: true, lineWidth: 1.5, curveType: monotone, connectNulls: false }
```

These five are the complete set. There is **no** `yAxis` / `min` / `max`, `legend` object, `stack` / `stacking`, area / fill, `thresholds`, `decimals`, `pointRadius`, or per-series color. Series colors come from a fixed 6-color palette assigned by order (wrapping after 6) and are not configurable.

## Data shape

Return a **time column** plus one or more **numeric** columns:

- **Time column** — aliased to a detected name (case-insensitive prefix): `ts`, `time`, `timestamp`, `date`, `datetime`, `created_at`, `period`, `bucket`, `interval`. No match → the chart draws nothing. Bucket it adaptively with `toStartOfInterval(col, INTERVAL {step:UInt32} SECOND)`.
- **Numeric columns** → one line each. Quoted ClickHouse integers (e.g. `"42"`) count as numeric.

### One line per label (string pivot) — mind the precondition

A non-numeric **string** column pivots a value column into one line per distinct value (e.g. one line per service):

```sql
-- ✅ exactly one numeric column + ServiceName → one line per service
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       ServiceName, count() AS spans
FROM traces WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, ServiceName ORDER BY ts
```

**The pivot fires only when the query returns exactly one numeric column.** With two or more numeric columns the string column is **ignored** and each numeric column becomes one line. So `SELECT ts, ServiceName, p50, p95, p99 ...` does **not** produce per-service lines — it produces three lines (p50/p95/p99) aggregated across services, and `ServiceName` is dropped.

To break **multiple** metrics out per service, use **one query per metric** (each returning that single metric + the string column); the queries overlay on one timeline. The label column can be any non-numeric string expression, including a computed one — e.g. `concat(ServiceName, ' p95') AS series` — which is the idiomatic way to keep the lines distinct across the overlaid per-metric queries. Multiple string columns concatenate into one label joined with ` · `.

## Behaviors to know

- **Multiple queries overlay** on one shared timeline; series colors continue across queries.
- **Gaps:** a line breaks where two consecutive points are more than ~1.5× the series' median interval apart. `connectNulls: true` bridges them. Irregularly-sampled series look broken unless bucketed evenly.
- **Edge buckets are partial** (the picker rarely lands on a bucket boundary): the leading bucket is kept but clipped at the left edge, and the trailing bucket reads low. Don't mistake the trailing dip for a real regression.
- **Drag across the plot to zoom** — a user action that rewrites the time range; nothing to configure.
