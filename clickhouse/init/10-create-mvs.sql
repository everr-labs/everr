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

-- Optional one-time backfill for rows already present in source tables.
-- Uncomment if needed.
-- INSERT INTO app.traces
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_traces;
--
-- INSERT INTO app.logs
-- SELECT *, toUInt64OrZero(ResourceAttributes['everr.tenant.id']) AS tenant_id
-- FROM otel.otel_logs;
