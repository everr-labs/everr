# StatChart

One or more big single-value tiles, each optionally with a sparkline and threshold coloring.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `calculation` | string | `last` | `last`, `first`, `mean`, `min`, `max`, `sum`, `count`, `range`, `diff` | How each tile's column is reduced to one number. `count` = number of points, `range` = max − min, `diff` = last − first. An unknown value is rejected by `everr apply`. |
| `unit` | string | `""` | any string | Suffix after the value. |
| `decimals` | number | none | `0`–`10` | Fixed fraction digits. Omitted: up to 2, trailing zeros dropped. |
| `sparkline` | boolean | `false` | `true` | Draw a trend line under the value. **Needs a time column and ≥2 points** (see Data shape) or nothing draws. |
| `colorMode` | string | `value` | `value`, `background` | `value` tints the number with the threshold color; `background` fills the whole tile. No effect without `thresholds`. |
| `showLabel` | boolean | `false` | `true` | Show the column-name label even on a single-tile panel (multi-tile always shows it). |
| `noValue` | string | `–` | any string | Text rendered for a query that produced no value (empty result / no numeric column). |
| `thresholds` | object | none | see below | Color the value (and sparkline). Omit for default text color. |

### `thresholds`

| Field | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `mode` | string | `absolute` | `absolute`, `percent` | `absolute` compares the raw value; `percent` compares `value / max × 100`. |
| `max` | number | tile's series max | any number | Reference for `percent` mode. Set it (e.g. an SLA ceiling) so percentages don't shift with the time window. Non-positive → no step is crossed. |
| `defaultColor` | string | none | CSS color | Color before any step is crossed. Optional. |
| `steps` | array | `[]` | `{ value: number, color?: string }` | Sorted ascending internally; the **highest step whose `value` ≤ the compare value wins**. A step with no `color` is crossed but leaves the color unchanged. |

```yaml
plugin:
  kind: StatChart
  spec:
    calculation: last
    unit: "%"
    decimals: 1
    sparkline: true
    thresholds:
      mode: absolute
      defaultColor: "#22c55e"            # green below the first step
      steps:
        - { value: 1, color: "#f59e0b" }   # amber once value ≥ 1
        - { value: 5, color: "#ef4444" }   # red once value ≥ 5
```

There is **no** `title`, `orientation`, or `graphMode`. `calculation`, `unit`, and `thresholds` apply to **every** tile uniformly.

## Data shape — one tile per numeric column per query

- **Each numeric column → one tile**, reduced by `calculation`. N numeric columns × M queries = N×M tiles. To show p50/p95/p99 side by side, return three numeric columns from one query.
- A **string** column creates **no** tile and is ignored — there is no per-label split here (unlike TimeSeriesChart). To break a stat out by label, pivot in SQL into separate numeric columns: `countIf(ServiceName = 'api') AS api, countIf(ServiceName = 'web') AS web`.
- **Sparkline** needs a detected **time column** (same aliases as TimeSeriesChart) and at least two points; `calculation: last` then reads the latest bucket. A time-less query shows the number but no sparkline.

## Behaviors to know

- A **single tile hides its label** unless `showLabel: true`; with multiple tiles each shows its column name. Choose column aliases accordingly.
- Values ≥ 1 million **abbreviate** (`1234567` → `1.23M`, then `B`, `T`); smaller values keep thousands grouping.
- A query that returns no value still renders its tile with the `noValue` text — it does not silently vanish from a multi-query panel.
- **`percent` mode** without `thresholds.max` compares against the tile's own series max, so a single-value (time-less) tile is always 100% — set `max` or use it with a sparkline series.
- The resolved threshold color tints **both** the number and the sparkline (`colorMode: background` fills the tile instead).
- Value text scales down as tiles crowd the panel.
