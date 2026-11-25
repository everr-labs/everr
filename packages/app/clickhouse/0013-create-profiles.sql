-- Profiles are a development-stage OTLP signal: the exporter's columns may
-- change when the collector pin moves, so diff this against
-- internal/sqltemplates/profiles_table.sql on every upgrade. Attributes stay
-- maps because the exporter has no JSON mode for profiles.
CREATE TABLE IF NOT EXISTS otel.otel_profiles (
    Timestamp DateTime64(9),
    ProfileId String,
    SampleType LowCardinality(String),
    SampleUnit LowCardinality(String),
    ServiceName LowCardinality(String),
    ResourceAttributes Map(LowCardinality(String), String),
    ScopeName String,
    ScopeVersion String,
    ProfileAttributes Map(LowCardinality(String), String),
    SampleAttributes Map(LowCardinality(String), String),
    StackHash UInt64,
    Addresses Array(UInt64),
    FunctionNames Array(LowCardinality(String)),
    FileNames Array(LowCardinality(String)),
    LineNumbers Array(Int32),
    MappingFileNames Array(LowCardinality(String)),
    Values Array(Int64),
    TimestampsUnixNano Array(UInt64),
    DurationNano UInt64,
    Period Int64,
    PeriodType LowCardinality(String),
    PeriodUnit LowCardinality(String),
    TraceId String,
    SpanId String
) ENGINE = Null;

-- Profiles: tenant-enriched read table + MV. One row per sample, with its
-- stack inline (leaf first). Flame graphs filter one service and one sample
-- type over a time range, so both sit ahead of Timestamp in the key.
CREATE TABLE IF NOT EXISTS app.profiles
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, ServiceName, SampleType, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toLowCardinality(CAST(ResourceAttributes['everr.tenant.id'] AS String)) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_profiles
WHERE 1 = 0;

-- Bloom filters rather than the exporter's text indexes, for the reason given
-- on app.logs: the same rows read for has() and map lookups at a fraction of
-- the storage.
ALTER TABLE app.profiles
  ADD INDEX IF NOT EXISTS idx_profile_id ProfileId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_sample_attr_key mapKeys(SampleAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_sample_attr_value mapValues(SampleAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_function_names FunctionNames TYPE bloom_filter(0.01) GRANULARITY 1;

ALTER TABLE app.profiles
  MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `ProfileId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SampleType` CODEC(ZSTD(1)),
  MODIFY COLUMN `SampleUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ProfileAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `SampleAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StackHash` CODEC(ZSTD(1)),
  MODIFY COLUMN `Addresses` CODEC(ZSTD(1)),
  MODIFY COLUMN `FunctionNames` CODEC(ZSTD(1)),
  MODIFY COLUMN `FileNames` CODEC(ZSTD(1)),
  MODIFY COLUMN `LineNumbers` CODEC(ZSTD(1)),
  MODIFY COLUMN `MappingFileNames` CODEC(ZSTD(1)),
  MODIFY COLUMN `Values` CODEC(ZSTD(1)),
  MODIFY COLUMN `TimestampsUnixNano` CODEC(ZSTD(1)),
  MODIFY COLUMN `DurationNano` CODEC(ZSTD(1)),
  MODIFY COLUMN `Period` CODEC(ZSTD(1)),
  MODIFY COLUMN `PeriodType` CODEC(ZSTD(1)),
  MODIFY COLUMN `PeriodUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.profiles_mv
TO app.profiles
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    toLowCardinality(ResourceAttributes['everr.tenant.id']) AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_profiles
);
