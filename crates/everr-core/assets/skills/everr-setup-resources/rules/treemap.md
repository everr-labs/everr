# Treemap

Tiles whose **areas are proportional to a numeric column** — part-of-whole breakdowns like requests per route, storage per table, errors per service. Like every other visualization it infers structure from the columns you `SELECT` — the `*Column` options just name which columns to read.

## Options (`plugin.spec`)

| Option        | Type    | Default | Values      | Effect                                                                                                                                               |
| ------------- | ------- | ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nameColumn`  | string  | `name`  | column name | Tile label. Rows with a NULL label are dropped.                                                                                                      |
| `valueColumn` | string  | `value` | column name | Tile size. **Must be positive** — rows with a value ≤ 0 (or non-numeric) have no area and are dropped. Rows repeating the same label are **summed**. |
| `groupColumn` | string  | —       | column name | Group tiles: one color per group value, legend lists the groups, the same label may appear once per group. Rows with a NULL group are dropped.       |
| `maxTiles`    | number  | —       | ≥ 2         | Cap the tile count: the largest `maxTiles - 1` tiles stay, the rest merge into one muted, ungrouped "Other (n)" tile. Unset renders every row.       |
| `unit`        | string  | `""`    | any string  | Suffix on tile and tooltip values (space-separated).                                                                                                 |
| `showValues`  | boolean | `true`  | `false`     | Render the value inside tiles large enough to fit it.                                                                                                |
| `showLegend`  | boolean | `true`  | `false`     | Group color legend — only appears when there are groups (from `groupColumn` or multiple queries).                                                    |

```yaml
plugin:
  kind: Treemap
  spec: { nameColumn: route, valueColumn: requests, groupColumn: service, unit: req }
```

These seven are the complete set. There is **no** nesting depth, drill-down, color-by-value ramp, per-tile color column, aggregation option (duplicates always sum — pre-aggregate in SQL for anything else), or sort option. To cap tile count, prefer `maxTiles` (folds the tail into an "Other" tile, preserving the total) over SQL `LIMIT` (silently drops the tail).

## Data shape

One row per tile: a label column + a **positive** numeric column, optionally a group column.

```sql
-- requests per route, grouped (colored) by service
SELECT ServiceName AS service,
       SpanAttributes['http.route'] AS route,
       count() AS value
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
  AND SpanAttributes['http.route'] != ''
GROUP BY service, route
ORDER BY value DESC
LIMIT 50
```

Always bound the tile count — hundreds of tiles render as unreadable slivers. Set `maxTiles` (keeps the total honest via the "Other" tile) and/or `LIMIT` in SQL. Dropped rows (NULL label/group, value ≤ 0) surface as an "N rows not shown" badge on the panel; rows folded into "Other" are shown, not dropped.

## Behaviors to know

- **No time axis.** A treemap aggregates the selected range into one picture; still scope the `WHERE` to `{from}`/`{to}` so it follows the picker.
- **Values must be additive for the areas to mean anything.** Counts, bytes, total durations work; percentiles or rates per tile are misleading (areas imply a sum).
- **Color encodes the group**, not the value: `groupColumn` value when set; the query when the panel has multiple queries and no `groupColumn`; otherwise tiles just cycle the palette.
- Labels (and values with `showValues`) only draw on tiles big enough to fit them — small tiles stay color-only, the tooltip always has the full name, group, and value.
- A query returning no tileable rows renders a "No data to tile in this result" empty state.
