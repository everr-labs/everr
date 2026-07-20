# SLO SLI rollups: cheap windowing for simple SLIs

## What
Pre-aggregate simple `countIf`-style SLIs into time-bucketed rollups so budget and burn-rate windows read pre-summed buckets instead of rescanning raw telemetry each evaluation, letting us drop (or relax) the `/12` refresh throttle for those SLOs.

## Why
Today an SLI is arbitrary ClickHouse SQL over raw telemetry (`countIf(<predicate>) FROM app.logs WHERE ts IN window`). Producing a fresh window value means scanning the whole window of raw rows, so the engine throttles long windows via `is_window_due` (`refresh = max(base_cadence, window_secs / 12)` in `crates/clickety-clack/src/engine/slo_math.rs`). For a 1d window that's ~2h between recomputes, which is why the budget-over-time chart's points are sparse.

The samples we now push to `app.metrics_gauge` (`cc.slo.good` / `cc.slo.valid`) made the *chart read* cheap, but not the *engine recompute* — those samples are the output of the scan, not an input that avoids it.

Datadog and Grafana avoid the rescan entirely, but by constraining the SLI:
- Grafana/Sloth/Pyrra: SLI is a Prometheus cumulative-counter ratio; a windowed rate is essentially the counter's endpoints, and recording rules pre-materialize the burn rates on a fixed interval.
- Datadog: SLI rides on pre-aggregated metric time series (or monitor state); even log SLOs go through a log-based metric materialized at ingest. Windowing is a range-sum over rollup series.

Both trade raw-query flexibility for cheap windowing. We can offer the same cheap path for the common case while keeping arbitrary SQL as the general escape hatch.

## Approach (sketch)
For SLIs the engine can decompose (a `countIf`/`count` over a table with a time column, no `uniq`/`quantile`/dedup):
- Materialize per-bucket `(good, valid)` counts (e.g. a 1-minute AggregatingMergeTree MV, or engine-written rollup rows), keyed by the SLI's predicate.
- A window value becomes a `sum` over the buckets in `[t - window, t]` — cheap and index-friendly.
- Alternatively, incremental maintenance: keep the prior window's counts and adjust by adding the new tail `[last_eval, now]` and subtracting the aged-out head `[old_start, new_start]` (two small-range queries). Works for additive aggregates only.

Then drop the `/12` throttle for rollup-backed SLIs (dense budget/burn history, richer chart), and fall back to the current full-scan + throttle for opaque SQL.

## Constraints / open questions
- Detecting which SLIs are safe to roll up (parse/whitelist `countIf`/`count` shapes; refuse `uniqExact`, `quantile`, joins, dedup).
- Where the rollup lives: a per-SLI MV vs a generic `slo_bucket_counts` table the engine writes alongside the current sample gauges.
- Cardinality of per-group rollups (the `label_columns` fan-out) at fine buckets.
- Keeping the derived budget/burn identical to the full-scan result (no drift between the two paths).
- Interaction with the raw-telemetry TTL (rollups can outlive raw data, which is a feature).

## Related
Follows the raw-sample work: `cc.slo.good`/`cc.slo.valid` gauges + `sloBurnRate`/`sloBudgetRemaining` UDFs + the "Error budget over time" chart on the SLO detail page.
