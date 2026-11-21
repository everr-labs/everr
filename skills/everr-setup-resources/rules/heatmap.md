# Heatmap

A **time × bucket grid of color-intensity cells** — request-duration histograms over time, status-code distributions, per-entity activity. The time column is the x-axis (or a category column, with `xColumn`), a bucket column is the y-axis, and a numeric column drives the cell color. Rows landing on the same (x, bucket) cell **sum** — within a query and across queries.

## Options (`plugin.spec`)

| Option        | Type    | Default                        | Values                                                             | Effect                                                                                                                                  |
| ------------- | ------- | ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `xColumn`     | string  | none (time x-axis)             | column name                                                        | Category x-axis: one column per distinct value, no time column needed. See below.                                                       |
| `yColumn`     | string  | first non-time, non-x column   | column name                                                        | Y-bucket column.                                                                                                                        |
| `valueColumn` | string  | first remaining numeric column | column name                                                        | Cell intensity column.                                                                                                                  |
| `valueFormat` | object  | none                           | see shared rule                                                    | Numeric presentation; read `rules/value-format.md` for scaling, precision, rates and custom labels.                                     |
| `showLegend`  | boolean | `true`                         | `false`                                                            | Color ramp legend (min → max) below the grid.                                                                                           |
| `showValues`  | boolean | `false`                        | `true`                                                             | Render the value inside cells wide enough to fit it.                                                                                    |
| `colorScheme` | enum    | `spectral`                     | `spectral`, `greenYellowRed`, `blues`, `greens`, `oranges`, `reds` | Cell color ramp. `spectral` = cool blue → yellow → hot red; `greenYellowRed` = green → amber → red; the rest are single-hue light→dark. |
| `scaleType`   | enum    | `linear`                       | `sqrt`, `log`                                                      | Value→color curve. `log` spreads heavily skewed data (histogram counts) so sparse cells stay visible.                                   |
| `min`         | number  | `0` (data min if negative)     | any                                                                | Lower bound of the color domain — cells at or below it clamp to the ramp's low-end color.                                               |
| `max`         | number  | data max                       | any                                                                | Upper bound of the color domain. Set it (an expected ceiling) for colors that don't shift with the time window.                         |
| `cellGap`     | number  | `1`                            | `0`–`4`                                                            | Gap between cells in px.                                                                                                                |

```yaml
plugin:
  kind: Heatmap
  spec:
    yColumn: bucket
    valueColumn: requests
    colorScheme: spectral
    scaleType: log
    valueFormat:
      unit: "{request}"
```

There is **no** `calculation`, `thresholds`, axis options, or client-side bucketing of raw values — compute the y buckets in SQL.

## Data shape — time + bucket + value, long format

- A **time column is required** unless `xColumn` is set. Alias it to `ts`, `time`, or `timestamp` (exact name, case-insensitive). A frame without one renders nothing.
- `GROUP BY` time and bucket, one row per cell:

```sql
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       multiIf(Duration < 1e7, '<10ms',
               Duration < 1e8, '<100ms',
               Duration < 1e9, '<1s', '≥1s') AS bucket,
       count() AS requests
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, bucket
ORDER BY ts
```

- Multiple queries are allowed — same-cell values sum across them and share one color domain.

## Data shape — category x-axis (`xColumn`)

For a grid over something other than time (hour of day × weekday, region × tier), set `xColumn`. No time column is needed: each row is one cell, and rows sharing an x and a bucket sum. Still filter on `{from}` / `{to}` so the time picker picks the data that goes in.

```sql
SELECT toHour(Timestamp) AS hour,
       toDayOfWeek(Timestamp) AS dow,
       dateName('weekday', Timestamp) AS weekday,
       count() AS requests
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY hour, dow, weekday
ORDER BY dow, hour
```

```yaml
plugin:
  kind: Heatmap
  spec: { xColumn: hour, yColumn: weekday, valueColumn: requests }
```

- All-numeric x values sort **ascending left to right** (hours read 0 to 23); otherwise columns keep **first-seen order**, so `ORDER BY` sets them.
- A query without the `xColumn` column renders nothing.
- Keep x **cardinality low** (hours, weekdays, regions): every distinct value is a grid column, with no cap.
- Set `valueColumn` when the query also returns a numeric helper column for sorting (`dow` above): the default picks the first numeric column other than x and y.
- No drag-to-zoom; the tooltip title is the x label.

## Behaviors to know

- **All-numeric buckets sort largest-at-top** like a y-axis (good for histogram bound labels like `50`, `100`, `250`); any non-numeric bucket switches to **first-seen order** top-down. For ordered text buckets (`<10ms`, `<100ms`, …) emit rows in the order you want, or use numeric bounds.
- **Cells are opaque** — a `min`-valued cell gets the ramp's low-end color; a missing cell draws nothing (panel background). Counts of 0 are best left unemitted (the natural `GROUP BY` behavior) so they read as gaps, not low values.
- **Pick the ramp semantically:** `greenYellowRed` when low is good and high is bad (errors, latency); `spectral` or a single-hue ramp for neutral densities (request volume, activity).
- Keep bucket **cardinality low** (≲ 15 rows) — every distinct bucket is a grid row.
- Use `scaleType: log` when one hot cell would wash out the rest — typical for latency histograms.
- On a time x-axis, cells are clamped to the picked range; each cell spans from its timestamp to the next distinct one.
- With a time x-axis, drag horizontally to zoom into a sub-range (same as TimeSeriesChart).
