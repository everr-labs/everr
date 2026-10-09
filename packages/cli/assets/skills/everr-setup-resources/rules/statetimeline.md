# StateTimeline

Horizontal lanes of colored segments showing **discrete states over time** — service health, deploy phases, CI status, on/off conditions. Each sample's state holds until the lane's next sample; the last one holds to the end of the time range.

A sample here is a **state transition**, not an observation: durations stretch to fill time and equal neighbors merge. If each row is instead an independent periodic check or run (health probe, cron job, per-bucket CI result) where a *missing* sample should be visible as a hole, use `StatusHistory` (`rules/statushistory.md`) — it takes the same data shapes but draws one discrete cell per sample with no carry-over.

## Options (`plugin.spec`)

| Option | Type | Default | Values | Effect |
| --- | --- | --- | --- | --- |
| `seriesColumn` | string | none | column name | Long-format input: one lane per distinct value of this column. Unset → wide format (one lane per non-time column). |
| `stateColumn` | string | first remaining column | column name | Where the state is read from in long format. Ignored without `seriesColumn`. |
| `mergeConsecutive` | boolean | `true` | `false` | `true` collapses consecutive samples with the same state into one segment; `false` renders one box per sample — though if that's the goal, `StatusHistory` is usually the better fit. |
| `showValues` | boolean | `true` | `false` | Render the state text inside segments wide enough to fit it. |
| `showLegend` | boolean | `true` | `false` | State color legend below the timeline. |
| `colors` | object | `{}` | `{ <state>: <CSS color> }` | Fixed state → color mapping. Unmapped states cycle the shared palette in first-seen order. |
| `rowHeight` | number | `0.9` | `0.2`–`1` | Segment thickness as a fraction of the lane height. |

```yaml
plugin:
  kind: StateTimeline
  spec:
    seriesColumn: service
    stateColumn: status
    colors:
      ok: "#22c55e"          # map semantically — green for healthy,
      warn: "#f59e0b"        # amber for degraded,
      error: "#ef4444"       # red for failing
```

There is **no** `calculation`, `unit`, `thresholds`, or value mapping. States are categorical: numbers and booleans are stringified into discrete states (`0`, `1`, `true`), never plotted on an axis.

## Data shape — a time column plus state columns

- A **time column is required** — alias to `ts`, `time`, or `timestamp` (exact name, case-insensitive). A frame without one renders nothing.
- **Wide format (default):** every non-time column is its own lane; the cell value is the state.
- **Long format (`GROUP BY` rows):** set `seriesColumn` to pivot one lane per label, with the state read from `stateColumn`:

```sql
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       ServiceName AS service,
       if(countIf(StatusCode = 'Error') > 0, 'error', 'ok') AS status
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, service
ORDER BY ts
```

- Multiple queries are allowed — lanes accumulate across them and all states share one legend and palette.

## Behaviors to know

- **A state persists until the next sample.** A lane's last sample extends to the end of the picked range — emit a row per bucket (or at every state change) and return `NULL` where "no data" should show as a **gap** instead of the previous state bleeding on.
- **`NULL` state = gap**, not a state: no segment is drawn and nothing enters the legend.
- **Map `colors` semantically** whenever states have conventional meanings (ok/error, up/down) — palette order depends on which state happens to appear first in the data.
- Keep state **cardinality low** (≲ 6 distinct states) — every distinct value gets its own color and legend entry.
- Segments are clamped to the picked range; a state that began before it still paints the window it covers.
- Drag horizontally to zoom into a sub-range (same as TimeSeriesChart).
