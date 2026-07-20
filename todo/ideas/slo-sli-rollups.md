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

## Key decision (sets the whole estimate)
Do rollup-eligible SLIs stay as arbitrary SQL, or become a structured declaration?
- **Auto-detect a safe subset of raw SQL** (keep today's UX): needs a SQL parser/validator that reliably recognizes the decomposable shape and *rejects everything else*. Correctness-critical (a misclassification means a silently-wrong SLO) and the long pole. ~4-6+ weeks.
- **Structured "fast SLI" form** (`{good_expr, valid_expr, table, time_column}`) for the rollup path, with raw SQL kept as the general escape hatch: skips the parser because the user hands over the decomposable pieces. This is exactly how Datadog/Grafana avoid the problem. ~2-3 weeks.

Recommended: ship the structured fast-SLI + rollup path, keep raw SQL as the escape hatch (strictly additive; arbitrary SQL still works, it just doesn't get the rollup unless expressed in the fast form).

## Effort
Rough scoping from reading the engine (not a written design): **2-6 weeks for one engineer**, the range driven almost entirely by the decision above. Much of the plumbing already exists from the raw-sample work, which pulls the number down.

Already built (reused, not rewritten):
- Emission pipeline (engine -> collector `metrics/trusted` -> `app.metrics_gauge`); a rollup just changes the granularity of what's emitted.
- The `sloBurnRate`/`sloBudgetRemaining` UDFs (compute from whatever good/valid they're fed).
- The "Error budget over time" chart (would get denser data for free).

Work items: SLI shape handling (S with structured form / L with auto-parse) · bucketed emission over the new tail (M) · window read as `sum` over buckets (M) · one-time backfill on enable (M) · relax `/12` for rollup-backed windows (S) · rollup table schema/partition/TTL (S-M) · parity tests rollup-vs-raw (M).

## Constraints / open questions
- Structured-vs-raw-SQL SLI decision (see Key decision) — resolving it as the structured form removes the SQL-parser long pole.
- **Late-arriving data (biggest risk).** An incrementally-built rollup fixes each bucket at eval time; a full re-scan catches events that land late, so the two can disagree and undermine the no-drift guarantee. Incumbents handle this with ingestion-time aggregation + acceptance/finalization windows. This is real design work and the item most likely to stretch the estimate; treat it as an explicit design item, not an afterthought.
- Where the rollup lives: a per-SLI MV (DDL churn + engine needs admin rights) vs a generic `slo_bucket_counts` table the engine writes alongside the current sample gauges (favored — no DDL, aligned with what we already write).
- Cardinality of per-group rollups (the `label_columns` fan-out) at fine buckets.
- Keeping the derived budget/burn identical to the full-scan result (no drift between the two paths).
- Interaction with the raw-telemetry TTL (rollups can outlive raw data, which is a feature).

## Related
Follows the raw-sample work: `cc.slo.good`/`cc.slo.valid` gauges + `sloBurnRate`/`sloBudgetRemaining` UDFs + the "Error budget over time" chart on the SLO detail page.
