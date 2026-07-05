# GeoMap

A world map. Two modes: `points` plots latitude/longitude markers sized by a value; `choropleth` shades whole countries by a value keyed on an ISO-3166 country code. Like every other visualization it infers structure from the columns you `SELECT` — the `*Column` options just name which columns to read.

## Options (`plugin.spec`)

| Option         | Type    | Default         | Values                                    | Effect                                                                                                                                                                                                                                          |
| -------------- | ------- | --------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`         | string  | `points`        | `points`, `choropleth`                    | Markers at coordinates vs. shaded countries.                                                                                                                                                                                                    |
| `latColumn`    | string  | `lat`           | column name                               | Latitude column (points mode). Rows outside ±90 are dropped.                                                                                                                                                                                    |
| `lonColumn`    | string  | `lon`           | column name                               | Longitude column (points mode). Rows outside ±180 are dropped.                                                                                                                                                                                  |
| `regionColumn` | string  | `region`        | column name                               | ISO-3166 **alpha-2 or alpha-3** country code column (choropleth mode), case-insensitive — `US`, `usa`, `DE`. Anything else (full names, "UK" instead of `GB`) does not resolve.                                                                 |
| `aggregation`  | string  | `sum`           | `sum`, `avg`, `min`, `max`, `last`        | Choropleth: how rows mapping to the same country combine. `sum` is only correct for additive metrics (request counts); use `avg`/`max` for latencies, percentiles, rates. `last` follows result-set order — only meaningful with an `ORDER BY`. |
| `valueColumn`  | string  | `value`         | column name                               | Sizes markers (points) / shades countries (choropleth).                                                                                                                                                                                         |
| `labelColumn`  | string  | —               | column name                               | Tooltip title. Falls back to the country name (choropleth) or raw coordinates (points).                                                                                                                                                         |
| `unit`         | string  | `""`            | any string                                | Suffix on tooltip and legend values (space-separated).                                                                                                                                                                                          |
| `showLegend`   | boolean | `true`          | `false`                                   | Points: the value→marker-size mapping plus per-query color swatches when the panel has multiple queries. Choropleth: the color ramp with its bounds.                                                                                            |
| `colorScheme`  | string  | `blue`          | `blue`, `green`, `orange`, `red`          | Marker base color / choropleth ramp color.                                                                                                                                                                                                      |
| `projection`   | string  | `naturalEarth1` | `naturalEarth1`, `mercator`, `equalEarth` | Map projection.                                                                                                                                                                                                                                 |
| `scaleType`    | string  | `linear`        | `linear`, `sqrt`, `log`                   | Value→size/color curve. `sqrt` keeps marker **area** proportional to the value; `log` keeps small values visible when one country dominates.                                                                                                    |
| `minRadius`    | number  | `3`             | > 0                                       | Points: smallest marker radius, in viewBox units (the map viewBox is 980×500).                                                                                                                                                                  |
| `maxRadius`    | number  | `22`            | > 0                                       | Points: largest marker radius.                                                                                                                                                                                                                  |
| `min`          | number  | auto            | any number                                | Lower bound of the color/size domain. Unset: **0** in choropleth (legend reads 0→max; data min if values go negative), the data minimum in points.                                                                                              |
| `max`          | number  | auto            | any number                                | Upper bound of the domain. Unset: the data maximum.                                                                                                                                                                                             |

```yaml
plugin:
  kind: GeoMap
  spec:
    {
      mode: choropleth,
      regionColumn: country,
      valueColumn: requests,
      aggregation: sum,
      colorScheme: blue,
    }
```

These sixteen are the complete set. There is **no** zoom/pan config, custom geojson, city/state-level regions (countries only), heatmap mode, cluster mode, or per-marker color column. Marker color encodes which _query_ a row came from, not a data column.

## Data shape

- **Points:** one row per marker — numeric `latColumn` + `lonColumn`, plus optional `valueColumn` (marker size) and `labelColumn` (tooltip). Rows with missing/invalid coordinates are skipped.
- **Choropleth:** one row per country — `regionColumn` with an ISO alpha-2/alpha-3 code + numeric `valueColumn`. Rows that repeat a country are combined with `aggregation`; codes that don't resolve are skipped.

Skipped rows in either mode surface as an "N rows not mapped" badge on the panel — if you see it, your coordinates or country codes are wrong, not hidden.

```sql
-- choropleth: requests per country (alpha-2 codes)
SELECT SpanAttributes['geo.country_code'] AS region,
       count() AS value
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
  AND SpanAttributes['geo.country_code'] != ''
GROUP BY region
```

The geo attribute names above are illustrative — discover what your telemetry actually carries before writing the query (see Startup Access). There is no GeoIP lookup in Everr; the query must already return codes or coordinates.

## Behaviors to know

- **No time axis.** A GeoMap aggregates the selected range into one picture; still scope the `WHERE` to `{from}`/`{to}` so it follows the picker.
- **Multiple queries:** points mode overlays them, one marker color per query (legend shows swatches). Choropleth merges all queries' rows into one shading via `aggregation`.
- **Choropleth shading fades from transparent (domain min) to the full scheme color (domain max)** — with the default 0-floored domain a shaded country never fades out entirely.
- Big markers render behind small ones, so overlapping small markers stay hoverable.
- A query returning no mappable rows renders a "No mappable data in this result" empty state.
