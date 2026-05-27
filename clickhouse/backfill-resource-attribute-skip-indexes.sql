-- Add and materialize ResourceAttributes skip indexes on app-facing telemetry
-- tables created before these indexes existed.
--
-- Run with an admin user, for example:
--
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/backfill-resource-attribute-skip-indexes.sql
--
-- MATERIALIZE INDEX rewrites index files for existing parts. It can take time
-- on large deployments; new inserts use the indexes as soon as ADD INDEX runs.

ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE app.logs
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE app.logs
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE app.traces MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.traces MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.logs MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.logs MATERIALIZE INDEX idx_res_attr_value;
