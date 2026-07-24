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

## Read-time charting is the same decision (not a separate path)

The "Error budget over time" chart now computes its series **at read time**: it
replays the SLI over a trailing window at each plotted point, directly against
raw telemetry (`packages/app/src/data/cc/slo-series.server.ts`). No stored
samples, no backfill — a freshly-created SLO shows history as far back as raw
retention goes. That deleted the whole store-derived-samples-and-backfill
apparatus (which foundered on `metrics_gauge` being day-partitioned by
`TimeUnix`: past-dated writes explode partitions, and its TTL is keyed on the
data timestamp). But it's expensive by construction: N independent full-window
scans per chart load, windows overlapping ~11/12.

A colleague's observation makes the connection explicit: *if the SLI respects a
bucketable standard, "just chart the query" collapses from N overlapping
full-window scans to ONE bucketed scan plus a rolling window*, entirely at read
time — `SELECT toStartOfInterval(ts, step) AS b, countIf(<good>), count() ...
GROUP BY b`, then `sum(...) OVER (... RANGE <window> PRECEDING ...)`. Aligning
buckets to fixed boundaries makes it deterministic and cacheable. So the
structured-SLI decision below doesn't only make *live eval* cheap; it's the same
lever that turns the read-time chart from expensive-per-load into a single cheap
query. Read-time also sidesteps the late-arriving-data drift risk entirely (it
always reflects current raw state), which the stored/incremental rollup path
does not. Opaque SLIs (`uniq`/`quantile`/joins/dedup) have no bucket standard
and stay on the expensive per-point path.

## Key decision (sets the whole estimate)
Do rollup-eligible SLIs stay as arbitrary SQL, or become a structured declaration?
- **Auto-detect a safe subset of raw SQL** (keep today's UX): needs a SQL parser/validator that reliably recognizes the decomposable shape and *rejects everything else*. Correctness-critical (a misclassification means a silently-wrong SLO) and the long pole. ~4-6+ weeks.
- **Structured "fast SLI" form** (`{good_expr, valid_expr, table, time_column}`) for the rollup path, with raw SQL kept as the general escape hatch: skips the parser because the user hands over the decomposable pieces. This is exactly how Datadog/Grafana avoid the problem. ~2-3 weeks.

Recommended: ship the structured fast-SLI + rollup path, keep raw SQL as the escape hatch (strictly additive; arbitrary SQL still works, it just doesn't get the rollup unless expressed in the fast form).

## Effort
Rough scoping from reading the engine (not a written design): **2-6 weeks for one engineer**, the range driven almost entirely by the decision above. Much of the plumbing already exists from the raw-sample work, which pulls the number down.

Already built (reused, not rewritten):
- Emission pipeline (engine -> collector `metrics/trusted` -> `app.metrics_gauge`); a rollup just changes the granularity of what's emitted.
- The burn-rate math as ClickHouse UDFs (parked below; nothing queries them today, so they were removed from `clickhouse/init/` until this work needs them).
- The "Error budget over time" chart (would get denser data for free).

Work items: SLI shape handling (S with structured form / L with auto-parse) · bucketed emission over the new tail (M) · window read as `sum` over buckets (M) · one-time backfill on enable (M) · relax `/12` for rollup-backed windows (S) · rollup table schema/partition/TTL (S-M) · parity tests rollup-vs-raw (M).

## Constraints / open questions
- Structured-vs-raw-SQL SLI decision (see Key decision) — resolving it as the structured form removes the SQL-parser long pole.
- **Late-arriving data (biggest risk).** An incrementally-built rollup fixes each bucket at eval time; a full re-scan catches events that land late, so the two can disagree and undermine the no-drift guarantee. Incumbents handle this with ingestion-time aggregation + acceptance/finalization windows. This is real design work and the item most likely to stretch the estimate; treat it as an explicit design item, not an afterthought.
- Where the rollup lives: a per-SLI MV (DDL churn + engine needs admin rights) vs a generic `slo_bucket_counts` table the engine writes alongside the current sample gauges (favored — no DDL, aligned with what we already write).
- Cardinality of per-group rollups (the `label_columns` fan-out) at fine buckets.
- Keeping the derived budget/burn identical to the full-scan result (no drift between the two paths).
- Interaction with the raw-telemetry TTL (rollups can outlive raw data, which is a feature).

## Parked: sloBurnRate / sloBudgetRemaining UDFs

Everr's SLO error-budget math as ClickHouse UDFs, so burn rate and remaining
budget can be derived at read time from the raw `(good, valid)` counts in
`app.metrics_gauge` by any SQL surface (rollup reads, dashboards, ad-hoc
`everr cloud query`) without hand-copying the formula.

They used to live in `clickhouse/init/05-create-slo-functions.sql` (plus a
`clickhouse/migrate-slo-functions.sql` for existing clusters) but nothing
queried them: the app's SLO surfaces compute the math in TypeScript
(`packages/app/src/data/cc/slo-series.server.ts`, byte-for-byte the engine's
`slo_math.rs`), and prod never had them installed. Parked here until this
rollup work (or a documented dashboards/ad-hoc story) actually consumes them.
If revived, they need a real deploy path to prod, not a manual
clickhouse-client apply nothing tracks.

They MUST stay in step with the engine's canonical implementation in
`crates/clickety-clack/src/engine/slo_math.rs`. Parity anchor
(`burn_rate_canonical_example`): `sloBurnRate(9856, 10000, 99.9) = 14.4`.

```sql
-- Normalized burn rate: observed bad ratio over the window as a multiple of the
-- error budget. NULL at zero traffic (valid <= 0) or when there is no budget to
-- spend (target >= 100), matching the engine's `None` in both cases. The bad
-- ratio is clamped to [0, 1] exactly as `window_bad_ratio` does.
CREATE OR REPLACE FUNCTION sloBurnRate AS (good, valid, target) ->
  if(
    valid <= 0 OR target >= 100,
    NULL,
    greatest(0, least(1, 1 - good / valid)) / ((100 - target) / 100)
  );

-- Fraction of the error budget still available over the window. NULL propagates
-- from sloBurnRate at zero traffic; may be negative once the objective is
-- exceeded (burn rate above 1x).
CREATE OR REPLACE FUNCTION sloBudgetRemaining AS (good, valid, target) ->
  1 - sloBurnRate(good, valid, target);
```

## Related
Follows the raw-sample work: `cc.slo.good`/`cc.slo.valid` gauges + the "Error budget over time" chart on the SLO detail page.
