# Per-row `retention_at_ingest` column

## What

Replace the dictionary-at-TTL approach with a per-row materialized column. Each MV stamps `retention_at_ingest UInt32` from `dictGet('app.tenant_retention', ...)` at insert time; the table's TTL becomes `<Timestamp> + INTERVAL retention_at_ingest DAY`. Retention semantics shift from "current tier applies to all data" to "tier at ingestion applies forever to that data" — Datadog / Honeycomb-style.

## Why

- **Downgrade no longer drops historical pro data.** Old rows keep their pro retention; only new rows get free retention.
- **TTL evaluation becomes dict-free.** Removes the silent fail-open class of bug at merge time.
- **Industry-standard semantics.** Matches what users expect from comparable tools.

Trade-off: upgrades stop extending old data ("from now on" only), per-tenant override changes only affect new rows, and `ttl_only_drop_parts = 1` parts can linger longer because tier changes leak heterogeneous TTLs into the same part.

## Rough appetite

medium — schema change is small, but the backfill mutation grows with data volume. Cheap now, multi-hour ops task once trace/log volume is real.

## Notes

Migration playbook (no data loss if sequenced):

1. `ALTER TABLE … ADD COLUMN retention_at_ingest UInt32` on each target table (metadata-only).
2. `ALTER TABLE <mv> MODIFY QUERY` on each MV to populate the new column from `dictGet(...)` at insert.
3. Backfill old rows: `ALTER TABLE … UPDATE retention_at_ingest = dictGet(...) WHERE retention_at_ingest = 0`. Real mutation, throttle and watch `system.mutations`.
4. `ALTER TABLE … MODIFY TTL <Timestamp> + INTERVAL retention_at_ingest DAY`.

Safety: between steps 2 and 4 use a transitional TTL like `coalesce(retention_at_ingest, dictGet(...))` so unbackfilled rows still fall back to the dict, and step 4 can land before the backfill mutation completes.

Recommendation captured at decision time (2026-05-02): defer until either trigger above fires. Until then the current dict-at-TTL approach is materially simpler and the failure window is bounded by the next merge.
