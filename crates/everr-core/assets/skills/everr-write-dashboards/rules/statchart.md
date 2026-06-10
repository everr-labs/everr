# StatChart

One or more big single-value tiles, each optionally with a sparkline and threshold coloring.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `calculation` | string | `last` | `last`, `first`, `mean`, `min`, `max`, `sum` | How each tile's column is reduced to one number. An unknown value falls back to `last`. |
| `unit` | string | `""` | any string | Suffix after the value. No precision control — the value shows up to 2 decimals, locale-grouped. |
| `sparkline` | boolean | `false` | `true` | Draw a trend line under the value. **Needs a time column and ≥2 points** (see Data shape) or nothing draws. |
| `thresholds` | object | none | see below | Color the value (and sparkline). Omit for default text color. |

### `thresholds`

| Field | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `mode` | string | `absolute` | `absolute`, `percent` | `absolute` compares the raw value; `percent` compares `value / tileMax × 100`. |
| `defaultColor` | string | none | CSS color | Color before any step is crossed. Optional. |
| `steps` | array | `[]` | `{ value: number, color?: string }` | Sorted ascending internally; the **highest step whose `value` ≤ the compare value wins**. A step with no `color` is crossed but leaves the color unchanged. |

```yaml
plugin:
  kind: StatChart
  spec:
    calculation: last
    unit: "%"
    sparkline: true
    thresholds:
      mode: absolute
      defaultColor: "#22c55e"            # green below the first step
      steps:
        - { value: 1, color: "#f59e0b" }   # amber once value ≥ 1
        - { value: 5, color: "#ef4444" }   # red once value ≥ 5
```

There is **no** `min` / `max`, `decimals` / precision, `title`, `colorMode`, `orientation`, or `graphMode`. `calculation`, `unit`, and `thresholds` apply to **every** tile uniformly.

## Data shape — one tile per numeric column per query

- **Each numeric column → one tile**, reduced by `calculation`. N numeric columns × M queries = N×M tiles. To show p50/p95/p99 side by side, return three numeric columns from one query.
- A **string** column creates **no** tile and is ignored — there is no per-label split here (unlike TimeSeriesChart). To break a stat out by label, pivot in SQL into separate numeric columns: `countIf(ServiceName = 'api') AS api, countIf(ServiceName = 'web') AS web`.
- **Sparkline** needs a detected **time column** (same aliases as TimeSeriesChart) and at least two points; `calculation: last` then reads the latest bucket. A time-less query shows the number but no sparkline.

## Behaviors to know

- A **single tile hides its label**; with multiple tiles each shows its column name. Choose column aliases accordingly.
- **`percent` mode** compares against the tile's own series max, so a single-value (time-less) tile is always 100% — use `percent` with a sparkline series, not a scalar.
- The resolved threshold color tints **both** the number and the sparkline.
