-- One-shot migration for an existing cloud ClickHouse. Bundles three changes
-- that init/ only applies to fresh servers:
--   1. the errorFingerprint UDF                 (init/04-create-error-fingerprint-function.sql)
--   2. app.* skip indexes mirrored from otel.*  (init/10-create-mvs.sql)
--   3. 7-day retention on the raw otel.* tables (init/03-create-otel-tables.sql)
--
-- Apply with an admin user:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/migrate-errors-udf-app-indexes-otel-ttl.sql
--
-- Idempotent: CREATE OR REPLACE FUNCTION, ADD INDEX IF NOT EXISTS, MODIFY TTL.
-- MATERIALIZE INDEX rewrites index files for existing parts and can take time on
-- large tables; new inserts use every index/TTL as soon as ADD/MODIFY runs.
--
-- Assumes ResourceAttributes indexes on app.traces / app.logs were already
-- materialized by backfill-resource-attribute-skip-indexes.sql, so this file
-- adds them IF NOT EXISTS but does not re-materialize them.
--
-- WARNING: step 3 drops raw otel.* data older than 7 days. That data is not
-- queried directly (the durable, tenant-scoped read model is app.*, populated at
-- insert time by the app.*_mv views), but the drop is irreversible. Expired
-- day-parts are removed on the next merge.

-- 1. errorFingerprint UDF (keep in step with init/04-create-error-fingerprint-function.sql).
CREATE OR REPLACE FUNCTION errorFingerprint AS (serviceName, logAttributes) ->
  if(
    logAttributes['error.fingerprint'] != '',
    logAttributes['error.fingerprint'],
    toString(cityHash64(
      serviceName,
      logAttributes['exception.type'],
      substring(
        replaceRegexpAll(
          replaceRegexpAll(
            replaceRegexpAll(
              trim(BOTH ' ' FROM logAttributes['exception.message']),
              '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
              '<uuid>'
            ),
            '\\b[0-9]{6,}\\b|0x[0-9a-fA-F]+',
            '<id>'
          ),
          '''[^'']{16,}''|"[^"]{16,}"',
          '<quoted>'
        ),
        1,
        300
      ),
      ''
    ))
  );

-- 2. app.* skip indexes mirrored from otel.*.

ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_duration Duration TYPE minmax GRANULARITY 1;
ALTER TABLE app.traces MATERIALIZE INDEX idx_trace_id;
ALTER TABLE app.traces MATERIALIZE INDEX idx_span_attr_key;
ALTER TABLE app.traces MATERIALIZE INDEX idx_span_attr_value;
ALTER TABLE app.traces MATERIALIZE INDEX idx_duration;

ALTER TABLE app.logs
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8;
ALTER TABLE app.logs MATERIALIZE INDEX idx_trace_id;
ALTER TABLE app.logs MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.logs MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.logs MATERIALIZE INDEX idx_log_attr_key;
ALTER TABLE app.logs MATERIALIZE INDEX idx_log_attr_value;
ALTER TABLE app.logs MATERIALIZE INDEX idx_body;

-- Metrics tables had no skip indexes at all, so add and materialize the full set.
ALTER TABLE app.metrics_gauge
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_attr_key;
ALTER TABLE app.metrics_gauge MATERIALIZE INDEX idx_attr_value;

ALTER TABLE app.metrics_sum
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_attr_key;
ALTER TABLE app.metrics_sum MATERIALIZE INDEX idx_attr_value;

ALTER TABLE app.metrics_histogram
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_attr_key;
ALTER TABLE app.metrics_histogram MATERIALIZE INDEX idx_attr_value;

ALTER TABLE app.metrics_exponential_histogram
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_attr_key;
ALTER TABLE app.metrics_exponential_histogram MATERIALIZE INDEX idx_attr_value;

ALTER TABLE app.metrics_summary
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_res_attr_key;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_res_attr_value;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_scope_attr_key;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_scope_attr_value;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_attr_key;
ALTER TABLE app.metrics_summary MATERIALIZE INDEX idx_attr_value;

-- 3. 7-day retention on the raw otel.* landing tables.
ALTER TABLE otel.otel_traces MODIFY TTL toDateTime(Timestamp) + INTERVAL 7 DAY;
ALTER TABLE otel.otel_logs MODIFY TTL TimestampTime + INTERVAL 7 DAY;
ALTER TABLE otel.otel_metrics_gauge MODIFY TTL toDateTime(TimeUnix) + INTERVAL 7 DAY;
ALTER TABLE otel.otel_metrics_sum MODIFY TTL toDateTime(TimeUnix) + INTERVAL 7 DAY;
ALTER TABLE otel.otel_metrics_histogram MODIFY TTL toDateTime(TimeUnix) + INTERVAL 7 DAY;
ALTER TABLE otel.otel_metrics_exponential_histogram MODIFY TTL toDateTime(TimeUnix) + INTERVAL 7 DAY;
ALTER TABLE otel.otel_metrics_summary MODIFY TTL toDateTime(TimeUnix) + INTERVAL 7 DAY;
