# SLI windows end at `now()`, before the freshest data is visible

## What
The SLO evaluator binds every SLI query's `window_end` to the evaluation
timestamp, so a burn window is `[now - w, now)`: it always includes a trailing
slice of wall-clock time whose rows have not reached ClickHouse yet. Shifting
`window_end` back by an ingestion-delay allowance would make the engine measure
only settled intervals.

## Where
`crates/clickety-clack/src/evaluator/slo.rs`, in `evaluate_slo`:

```rust
let window_start = /* eval_ts - w.secs */;
let params = [
    ("window_start".to_string(), fmt_ch_datetime(window_start)),
    ("window_end".to_string(), fmt_ch_datetime(eval_ts)),
];
```

## Size of the effect (measured, dev stack)
Pairing log event times against `system.part_log` `NewPart` times for
`app.logs`: insert delay is a consistent **2 to 9 seconds** (18:06:25 landed at
18:06:34, 18:08:25 at 18:08:33, 18:12:43 at 18:12:51, 18:15:45 at 18:15:53).

So the effect is small in absolute terms, but it is measured against the
window, not the clock. The canonical fast-burn short window is floored at
`SHORT_WINDOW_FLOOR_SECS = 60`, so ~8s of invisible tail is ~13% of the entire
window, and it effectively widens every gap in the source data by that much.

## The larger, related problem
Ingestion delay is not what mostly empties a short window. Emission sparsity is.
Over an hour of dev telemetry:

| | |
|---|---|
| inter-arrival gap p50 | 15s |
| inter-arrival gap p90 | 61s |
| max gap | 182s |
| gaps exceeding 60s | 34 of 146 |
| eval ticks (30s) seeing an empty trailing 60s window | **11.7%** |

A 60s window is simply below the resolution of this SLI's data: nearly a quarter
of the gaps between consecutive rows are longer than the whole window. That is a
question about the short-window floor (and about `min_valid_events`), not about
query timing, and it deserves its own decision:

- Should `MIN_WINDOW_SECS` rise, so budget windows small enough to floor the
  short window are rejected outright?
- Should `SHORT_WINDOW_FLOOR_SECS` be derived from observed data density rather
  than fixed at 60s?
- Should a floored tier be dropped rather than evaluated at a window its data
  cannot support?

`TierVerdict::Unknown` (see `plan_tier_firing` / `present_for`) already stops the
empty windows from flapping alerts, so neither of these is urgent. They are about
the engine measuring something meaningful, not about it misbehaving.

## Sketch
- Add an ingestion-delay allowance (config, with a sane default) and bind
  `window_end = eval_ts - delay`, `window_start = window_end - w.secs`.
- Keep the freshness ledger (`window_computed_at`) keyed on the evaluation
  instant, not the shifted window end, so `is_window_due`'s cadence is unchanged.
- Consider deriving the delay per source by observing `now() - max(timestamp)`
  rather than making operators guess it. Note that this reading is confounded by
  sparsity: on quiet sources it measures time since the last row, not lag, which
  is exactly the mistake that produced the first draft of this file.
- Any allowance should be small relative to the shortest window in play, which
  ties back to the floor question above.

## Related
Found while debugging `demo/demo-always-burning` resolving and re-firing every
few minutes. That flapping was fixed by making a data gap hold the tier's state
instead of resolving it.
