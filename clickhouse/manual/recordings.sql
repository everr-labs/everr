-- Not applied on a fresh server. clickhouse/init creates these objects, and
-- the ClickHouse image only runs clickhouse/init (docker-entrypoint-initdb.d).
-- Existing clusters run this file once:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/manual/recordings.sql
-- everrRetentionDaysJson and everrStripRetentionKeys must already exist
-- (clickhouse/init/05-create-retention-functions.sql). sql_api_role and app_ro
-- must already exist. This file does not grant app.recordings to sql_api_role.

CREATE TABLE IF NOT EXISTS otel.otel_recordings (
    Timestamp DateTime64(9),
    TraceId String,
    SpanId String,
    TraceFlags UInt8,
    SeverityText LowCardinality(String),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String),
    Body String,
    ResourceSchemaUrl LowCardinality(String),
    ResourceAttributes JSON(max_dynamic_paths = 256),
    ResourceAttributesKeys Array(LowCardinality(String)),
    ScopeSchemaUrl LowCardinality(String),
    ScopeName String,
    ScopeVersion LowCardinality(String),
    ScopeAttributes JSON(max_dynamic_paths = 256),
    ScopeAttributesKeys Array(LowCardinality(String)),
    LogAttributes JSON(max_dynamic_paths = 256),
    LogAttributesKeys Array(LowCardinality(String)),
    EventName String
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS app.recordings
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, ServiceName, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toLowCardinality(toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id'))) AS tenant_id,
  toUInt16(0) AS retention_days,
  toString(getSubcolumn(LogAttributes, 'session.id')) AS session_id,
  toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')) AS stream_id,
  toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id')) AS clip_id
FROM otel.otel_recordings
WHERE 1 = 0;

ALTER TABLE app.recordings
  ADD INDEX IF NOT EXISTS idx_session_id session_id TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_stream_id stream_id TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_clip_id clip_id TYPE bloom_filter(0.001) GRANULARITY 1;

ALTER TABLE app.recordings
  MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SeverityText` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `Body` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `EventName` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1)),
  MODIFY COLUMN `session_id` CODEC(ZSTD(1)),
  MODIFY COLUMN `stream_id` CODEC(ZSTD(1)),
  MODIFY COLUMN `clip_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.recordings_mv
TO app.recordings
AS
SELECT
  * EXCEPT (ResourceAttributesKeys),
  everrStripRetentionKeys(ResourceAttributesKeys) AS ResourceAttributesKeys,
  toString(getSubcolumn(LogAttributes, 'session.id')) AS session_id,
  toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')) AS stream_id,
  toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id')) AS clip_id
FROM
(
  SELECT
    *,
    toLowCardinality(toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id'))) AS tenant_id,
    everrRetentionDaysJson(ResourceAttributes) AS retention_days
  FROM otel.otel_recordings
);

CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

DROP ROW POLICY IF EXISTS tenant_filter_recordings ON app.recordings;
CREATE ROW POLICY tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
