# StatusHistory

Horizontal lanes of **discrete colored cells, one per sample** — periodic health checks, cron-job runs, CI builds per bucket, SLO probes. Each sample renders as a fixed-width cell centered on its timestamp; nothing extends, nothing merges, and a missing sample stays **visibly empty**.

## StatusHistory vs StateTimeline — pick the right one

Both take the exact same data shapes (wide or long, same `seriesColumn`/`stateColumn` pivot). The difference is what a sample _means_:

|                   | `StateTimeline`                                                       | `StatusHistory`                                                        |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| A sample is…      | a **state transition** — the state holds until the lane's next sample | an **independent observation** — one cell, no carry-over               |
| Equal neighbors   | merge into one continuous band                                        | stay separate cells                                                    |
| Missing sample    | previous state keeps painting (use `NULL` to force a gap)             | empty slot, immediately visible                                        |
| Question answered | "what state was X in, for how long, and when did it change?"          | "what did each check return — and did it run at all?"                  |
| Use for           | service up/down, deploy phases, leader/follower, feature-flag state   | health probes, cron/batch outcomes, per-interval CI status, SLO checks |

Rule of thumb: if your query emits a row **because something changed**, use `StateTimeline`; if it emits a row **because a scheduled thing ran** (or one row per time bucket), use `StatusHistory`. A skipped cron run on a StateTimeline silently looks like the previous outcome continuing — on a StatusHistory it shows as a hole, which is usually the signal you care about.

## Options (`plugin.spec`)

| Option         | Type    | Default                | Values                      | Effect                                                                                                             |
| -------------- | ------- | ---------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `seriesColumn` | string  | none                   | column name                 | Long-format input: one lane per distinct value of this column. Unset → wide format (one lane per non-time column). |
| `stateColumn`  | string  | first remaining column | column name                 | Where the status is read from in long format. Ignored without `seriesColumn`.                                      |
| `showValues`   | boolean | `false`                | `true`                      | Render the status text inside cells wide enough to fit it (cells are often too narrow — off by default).           |
| `showLegend`   | boolean | `true`                 | `false`                     | Status color legend below the lanes.                                                                               |
| `colors`       | object  | `{}`                   | `{ <status>: <CSS color> }` | Fixed status → color mapping. Unmapped statuses cycle the shared palette in first-seen order.                      |
| `rowHeight`    | number  | `0.9`                  | `0.2`–`1`                   | Cell height as a fraction of the lane height.                                                                      |
| `colWidth`     | number  | `0.9`                  | `0.2`–`1`                   | Cell width as a fraction of the sampling-interval slot — lower it for horizontal breathing room.                   |

```yaml
plugin:
  kind: StatusHistory
  spec:
    seriesColumn: check
    stateColumn: result
    colors:
      pass: "#22c55e"
      fail: "#ef4444"
```

There is **no** `mergeConsecutive` (merging is the StateTimeline behavior), `calculation`, `unit`, or thresholds. Statuses are categorical: numbers and booleans are stringified into discrete statuses (`0`, `1`, `true`), never plotted on an axis.

## Data shape — a time column plus status columns

- A **time column is required** — alias to `ts`, `time`, or `timestamp` (exact name, case-insensitive). A frame without one renders nothing.
- **Wide format (default):** every non-time column is its own lane; the cell value is the status.
- **Long format (`GROUP BY` rows):** set `seriesColumn` to pivot one lane per label, with the status read from `stateColumn`:

```sql
SELECT toStartOfInterval(Timestamp, INTERVAL {step:UInt32} SECOND) AS ts,
       ServiceName AS service,
       if(countIf(StatusCode = 'Error') > 0, 'fail', 'pass') AS result
FROM traces
WHERE Timestamp >= {from:String} AND Timestamp <= {to:String}
GROUP BY ts, service
ORDER BY ts
```

- Multiple queries are allowed — lanes accumulate across them and all statuses share one legend and palette.

## Behaviors to know

- **Cell width is the sampling interval** — the smallest gap between distinct timestamps across all lanes, shared so cells stay grid-aligned even when a lane skips samples. One wildly-finer-grained lane shrinks every lane's cells; keep all queries on the same bucket size.
- **`NULL` status = no cell**, same as a missing row: an empty slot, nothing in the legend.
- **Don't over-bucket**: at ~500 `{step}` buckets cells are 1–2px wide. StatusHistory reads best with ≲ 100 cells per lane — use a coarser fixed interval (e.g. `INTERVAL 1 HOUR` over 24h) when the default `{step}` is too fine.
- **Map `colors` semantically** whenever statuses have conventional meanings (pass/fail, ok/error) — palette order depends on which status happens to appear first in the data.
- Keep status **cardinality low** (≲ 6 distinct statuses) — every distinct value gets its own color and legend entry.
- Cells falling entirely outside the picked range are dropped (no carry-in from before the range — unlike StateTimeline); cells straddling an edge are clamped to it.
- Drag horizontally to zoom into a sub-range (same as TimeSeriesChart).
