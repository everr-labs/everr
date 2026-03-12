-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (tenant_id, ServiceName, SpanName, toDateTime(Timestamp))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_traces
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_traces;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
ORDER BY (tenant_id, ServiceName, TimestampTime, Timestamp)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_logs
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_logs;

-- Metrics (Gauge): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_gauge
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_metrics_gauge
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_gauge_mv
TO app.metrics_gauge
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_metrics_gauge;

-- Metrics (Sum): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_sum
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_metrics_sum
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_sum_mv
TO app.metrics_sum
AS
SELECT
  *,
  toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
FROM otel.otel_metrics_sum;

-- Optional one-time backfill for rows already present in source tables.
-- Uncomment if needed.
-- INSERT INTO app.traces
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_traces;
--
-- INSERT INTO app.logs
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_logs;
--
-- INSERT INTO app.metrics_gauge
-- SELECT
--   gauge.*,
--   coalesce(
--     nullIf(toUInt64OrZero(gauge.ResourceAttributes['everr.tenant.id']), 0),
--     trace_tenants.tenant_id
--   ) AS tenant_id
-- FROM otel.otel_metrics_gauge AS gauge
-- INNER JOIN (
--   SELECT
--     any(tenant_id) AS tenant_id,
--     ResourceAttributes['cicd.pipeline.run.id'] AS run_id,
--     ResourceAttributes['cicd.pipeline.task.name'] AS job_name
--   FROM app.traces
--   WHERE ResourceAttributes['cicd.pipeline.run.id'] != ''
--     AND ResourceAttributes['cicd.pipeline.task.name'] != ''
--   GROUP BY run_id, job_name
-- ) AS trace_tenants
--   ON gauge.ResourceAttributes['cicd.pipeline.run.id'] = trace_tenants.run_id
--  AND gauge.Attributes['cicd.pipeline.task.name'] = trace_tenants.job_name;
--
-- INSERT INTO app.metrics_sum
-- SELECT
--   metric_sum.*,
--   coalesce(
--     nullIf(toUInt64OrZero(metric_sum.ResourceAttributes['everr.tenant.id']), 0),
--     trace_tenants.tenant_id
--   ) AS tenant_id
-- FROM otel.otel_metrics_sum AS metric_sum
-- INNER JOIN (
--   SELECT
--     any(tenant_id) AS tenant_id,
--     ResourceAttributes['cicd.pipeline.run.id'] AS run_id,
--     ResourceAttributes['cicd.pipeline.task.name'] AS job_name
--   FROM app.traces
--   WHERE ResourceAttributes['cicd.pipeline.run.id'] != ''
--     AND ResourceAttributes['cicd.pipeline.task.name'] != ''
--   GROUP BY run_id, job_name
-- ) AS trace_tenants
--   ON metric_sum.ResourceAttributes['cicd.pipeline.run.id'] = trace_tenants.run_id
--  AND metric_sum.Attributes['cicd.pipeline.task.name'] = trace_tenants.job_name;
