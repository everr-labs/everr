# BarChart

A bar chart over time **or** over categories. It infers its structure from the columns you `SELECT` — there is no axis, color, or per-series configuration.

## Options (`plugin.spec`)

| Option        | Type    | Default    | Values                       | Effect                                                                                                                                                                                                     |
| ------------- | ------- | ---------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `unit`        | string  | `""`       | any string                   | Suffix on value-axis ticks and tooltip values. Raw concatenation, **no space** — `unit: ms` renders `123ms`.                                                                                               |
| `showLegend`  | boolean | `false`    | `true`                       | Show the series legend. Only the literal `true` enables it.                                                                                                                                                |
| `stacking`    | string  | `none`     | `none`, `stacked`, `percent` | `none` draws series side by side; `stacked` piles them into one bar per x value; `percent` additionally normalizes each stack to 100% — the value axis becomes percentages while tooltips keep raw values. |
| `orientation` | string  | `vertical` | `vertical`, `horizontal`     | `vertical` draws bars bottom-up; `horizontal` draws them left-to-right with categories on the y-axis — prefer it for categorical data with long labels.                                                    |
| `showValues`  | boolean | `false`    | `true`                       | Draw each bar's value: on top (vertical) / to the right (horizontal) of grouped bars, centered inside stacked segments.                                                                                    |

```yaml
plugin:
  kind: BarChart
  spec: { unit: req, showLegend: true, stacking: stacked, orientation: vertical, showValues: false }
```

These five are the complete set. There is **no** `yAxis` / `min` / `max`, `barWidth`, `legend` object, `thresholds`, `decimals`, or per-series color. Series colors come from a fixed 6-color palette assigned by order (wrapping after 6) and are not configurable.

## Data shape

Two axis modes, picked automatically per query:

- **Time axis** — a column aliased to a detected name (case-insensitive **exact** match): `ts`, `time`, or `timestamp`. Each bucket becomes one bar group, sorted ascending. Bucket with `toStartOfInterval(col, INTERVAL {step:UInt32} SECOND)` — but note every bucket renders a bar, so wide ranges get thin bars; bar charts read best with coarse buckets (consider `toStartOfDay` for fixed daily breakdowns).
- **Category axis** — no time column: the **first non-numeric string column** is the category axis, in the query's row order (use `ORDER BY` + `LIMIT` to rank). Remaining numeric columns become series.

The string pivot works exactly like `TimeSeriesChart` and has the same precondition: a remaining non-numeric **string** column pivots a value column into one series per label **only when the query returns exactly one numeric column**.

```sql
-- ✅ category axis: one bar per service, ranked
SELECT ServiceName, count() AS spans
FROM traces WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ServiceName ORDER BY spans DESC LIMIT 10
```

```sql
-- ✅ stacked over time: one segment per status per bucket (pair with stacking: stacked)
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       StatusCode, count() AS spans
FROM traces WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, StatusCode ORDER BY ts
```

## Behaviors to know

- **Multiple queries merge** onto one shared axis (rows sharing an x value merge into one bar group); series colors continue across queries. Don't mix a time-axis query with a category-axis query in one panel.
- **Stacking applies across ALL series** in the panel, including across queries — there is no per-series stack opt-out.
- **`percent` mode** needs ≥ 2 series to be meaningful; with one series every bar is 100%.
- **A missing group at an x value is no bar, not a zero** — pivoted series simply skip x values where the label is absent.
- **`showValues` on dense time-bucketed data overlaps** — use it for small categorical charts, not 500-bucket time axes.
- No drag-to-zoom (unlike `TimeSeriesChart`).
