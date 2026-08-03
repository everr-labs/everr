# Short SLI windows sit below the resolution of sparse telemetry

## The problem
The floored 60s short window (`SHORT_WINDOW_FLOOR_SECS`, domain/slo.rs) is
often smaller than the gaps between consecutive rows of the data it measures.
Over an hour of dev telemetry:

| | |
|---|---|
| inter-arrival gap p50 | 15s |
| inter-arrival gap p90 | 61s |
| max gap | 182s |
| gaps exceeding 60s | 34 of 146 |
| eval ticks (30s) seeing an empty trailing 60s window | **11.7%** |

Nearly a quarter of the gaps between consecutive rows are longer than the
whole window. That is a question about the short-window floor (and about
`min_valid_events`), not about query timing, and it deserves its own decision:

- Should `MIN_WINDOW_SECS` rise, so budget windows small enough to floor the
  short window are rejected outright?
- Should `SHORT_WINDOW_FLOOR_SECS` be derived from observed data density rather
  than fixed at 60s?
- Should a floored tier be dropped rather than evaluated at a window its data
  cannot support?

`TierVerdict::Unknown` (see `plan_tier_firing` / `present_for`) already stops
the empty windows from flapping alerts, so none of this is urgent. It is about
the engine measuring something meaningful, not about it misbehaving.

## Prior work
The ingestion-delay half of the original investigation shipped: every SLI
window (engine `sli_window_bounds`, app read-time scans, the `/v1/slos/test`
probe) ends `CC_SLO_INGEST_DELAY_SECS` (default 10s) before its instant, so
queries read only settled rows. Deriving that delay per source by observing
`now() - max(timestamp)` was considered and rejected: on quiet sources it
measures time since the last row, not lag, which is exactly the sparsity
confound this file is about.

## Related
Found while debugging `demo/demo-always-burning` resolving and re-firing every
few minutes. That flapping was fixed by making a data gap hold the tier's
state instead of resolving it.
