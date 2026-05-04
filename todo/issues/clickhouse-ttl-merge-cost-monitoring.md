## What

We dropped `ttl_only_drop_parts = 1` from `app.traces`, `app.logs`, `app.metrics_gauge`, `app.metrics_sum` so per-tenant TTL (via `dictGetOrDefault('app.tenant_retention', ...)`) actually deletes expired rows row-by-row. This is required for correctness — with the setting on, parts containing both free-tier and pro-tier rows would persist for the longest-lived row's retention, causing free-tier data (and downgraded customers' data) to linger far past its stated retention.

The trade-off: TTL merges now rewrite parts to filter expired rows instead of just dropping fully-expired parts. This adds background merge I/O. Need to monitor and revisit if it becomes a problem.

## Where

`clickhouse/init/10-create-mvs.sql` — TTL clauses on the four `app.*` telemetry tables.

## Steps to reproduce

N/A — this is a known operational trade-off, not a bug.

## Expected

TTL merge cost stays a small fraction of total merge activity. Roughly: 1–3 part rewrites per day-of-data per table (one rewrite per "TTL boundary crossing" — e.g., when 30-day rows expire while 90-day rows in the same part still survive).

## Actual

Unknown until measured at production scale. At early-stage volume the cost should be invisible.

## Priority

medium

## Notes

**What to watch for**:
- `system.merges` showing TTL merges dominating merge throughput.
- Background merge queue depth growing.
- Disk-space spikes during rewrites (a merge needs ~`size(input parts) + size(output part)` headroom).
- Slow ingest if merge threads are saturated by TTL rewrites.

**If it becomes a problem, options in order of preference**:

1. **Partition by tier**, not just date. Add a physical `tier` column populated by the materialized views (read from `dictGet` at insert time), then `PARTITION BY (toDate(...), tier)`. Each part becomes homogeneous-TTL, so re-enabling `ttl_only_drop_parts = 1` becomes correct and cheap. Adds ~2× partition count (still small at typical tenant counts). This is the right fix at scale.

2. **Tune TTL merge throttling** via `merge_with_ttl_timeout`, `max_replicated_merges_with_ttl_in_queue`, `max_number_of_merges_with_ttl_in_pool` to bound TTL merge concurrency vs. regular merges.

3. **Move expensive metrics rows to a separate table** with a different partitioning scheme if `app.metrics_sum`/`app.metrics_gauge` (longest pro retention at 395 days) dominate the rewrite cost.

**What NOT to do**: re-enable `ttl_only_drop_parts = 1` without one of the fixes above — it silently breaks the per-tenant retention contract documented in `packages/docs/content/docs/reference/retention.mdx`.
