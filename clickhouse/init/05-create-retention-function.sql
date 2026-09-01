-- everrRetentionDays: the retention, in days, stamped on every app.* row at
-- insert time. Each row carries its own `retention_days`, the tables partition
-- by (day, retention_days), and the TTL is `day + retention_days` with
-- ttl_only_drop_parts, so ClickHouse drops whole partitions and never rewrites
-- a part to expire a tenant. A retention change applies to rows ingested from
-- that point on; existing rows keep the retention they were stamped with.
--
-- The value set is bounded on purpose: the live partition count per table is
-- the sum of every distinct retention in use (a 90-day value costs 90 daily
-- partitions), so an unbounded value would grow it without limit. Values
-- outside the set collapse to the shortest one. The app writes the numbers
-- from packages/app/src/lib/retention.ts into app.tenant_retention_source;
-- keep that file and this set in step.
--
-- init/ runs only on a fresh server. Apply to an existing cluster with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/init/05-create-retention-function.sql
CREATE OR REPLACE FUNCTION everrRetentionDays AS (days) ->
  toUInt16(if(days IN (7, 14, 30, 90, 365, 395), days, 7));
