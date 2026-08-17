# GaugeChart

One or more gauges, each showing a single value filled between `min` and `max`, with optional threshold coloring and tick marks. Renders as a semicircular arc by default; `variant` switches to a flat horizontal bar.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `calculation` | string | `last` | `last`, `first`, `mean`, `min`, `max`, `sum`, `count`, `range`, `diff` | How each gauge's column is reduced to one number. `count` = number of points, `range` = max − min, `diff` = last − first. An unknown value is rejected by `everr apply`. |
| `unit` | string | `""` | any string | Suffix after the value. |
| `decimals` | number | none | `0`–`10` | Fixed fraction digits. Omitted: up to 2, trailing zeros dropped. |
| `min` | number | `0` | any number | Gauge axis lower bound. |
| `max` | number | `100` | any number | Gauge axis upper bound. **Set it to the metric's real ceiling** — the default 100 only suits percentages. Inverting the bounds (`min > max`) inverts the arc, so a lower value reads as fuller — useful for "lower is better" metrics. |
| `showLabel` | boolean | `false` | `true` | Show the column-name label even on a single-gauge panel (multi-gauge always shows it). |
| `noValue` | string | `–` | any string | Text rendered for a query that produced no value (empty result / no numeric column). |
| `variant` | string | none (= `arc`) | `arc`, `horizontal` | Rendering shape. Omitted or `arc`: semicircular arc. `horizontal`: flat bar filling left→right with the value text above it, a triangle marker at the value position and, with thresholds, multi-colored fill segments per band. |
| `showAxis` | boolean | `true` | `false` | Show the `min`/`max` axis labels: at the arc ends, or below the horizontal bar. |
| `showThresholdLabels` | boolean | `false` | `true` | Show a numeric label at each threshold tick mark (any variant). The label is the step position in axis units with the `unit` suffix, so a `percent` step reads as the value it lands on, not as the percentage you wrote. |
| `thresholds` | object | none | see below | Color the arc and mark step positions on the gauge. Omit for the default series color. |

### `thresholds`

| Field | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `mode` | string | `absolute` | `absolute`, `percent` | `absolute` compares the raw value; `percent` compares `value / max × 100`. |
| `max` | number | the gauge's `max` | any number | Reference for `percent` mode. |
| `defaultColor` | string | none | CSS color | Arc color before any step is crossed. Optional. |
| `steps` | array | `[]` | `{ value: number, color?: string }` | Sorted ascending internally; the **highest step whose `value` ≤ the compare value wins** and colors the filled arc. Each colored step also draws a tick mark at its position on the gauge. |

```yaml
plugin:
  kind: GaugeChart
  spec:
    calculation: mean
    unit: "%"
    decimals: 1
    min: 0
    max: 100
    thresholds:
      defaultColor: "#22c55e"            # green below the first step
      steps:
        - { value: 70, color: "#f59e0b" }  # amber once value ≥ 70
        - { value: 90, color: "#ef4444" }  # red once value ≥ 90
```

There is **no** `title`, `orientation`, `sparkline`, or `colorMode`. `calculation`, `unit`, `min`/`max`, and `thresholds` apply to **every** gauge uniformly.

## Data shape — one gauge per numeric column per query

- **Each numeric column → one gauge**, reduced by `calculation`. N numeric columns × M queries = N×M gauges. To show p50/p95/p99 side by side, return three numeric columns from one query.
- A **string** column creates **no** gauge and is ignored — pivot in SQL into separate numeric columns if you need a per-label split.
- No time axis is needed: a single-row aggregate (`SELECT avg(...) AS cpu_pct FROM ...`) is the natural query. With a time series, `calculation` reduces it (e.g. `last` reads the latest bucket).

## Behaviors to know

- **Choose `max` deliberately.** The arc reads as `(value − min) / (max − min)`; with the default `max: 100` a non-percentage metric renders as a nearly empty or pegged-full arc.
- Values **outside `[min, max]` clamp** the arc to empty/full — the centered text still shows the real value, so nothing is hidden, but the arc stops differentiating.
- A query that returns no value still renders its gauge (empty arc, `noValue` text) — it does not silently vanish from a multi-query panel.
- **`percent` thresholds** compare against `thresholds.max`, falling back to the gauge `max` — unlike StatChart there is no series-max fallback, so single-value queries behave predictably.
- Threshold ticks only render for steps that have a `color` and fall strictly inside `(min, max)`.
- Values ≥ 1 million **abbreviate** (`1234567` → `1.23M`, then `B`, `T`); the `min`/`max` end labels use the same formatting.
