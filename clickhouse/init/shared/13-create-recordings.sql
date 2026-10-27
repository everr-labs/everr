-- Session replay segments. The clickhouse/recordings exporter writes directly
-- to this table; there is no landing table and no materialized view.
-- ORDER BY (tenant_id, ServiceName, Timestamp) matches the player prefix.
-- Partition by day and retention, ttl_only_drop_parts, same TTL as app.logs.
-- Bloom filters on session_id, stream_id, and clip_id.
-- Existing clusters apply clickhouse/manual/recordings.sql.
CREATE TABLE IF NOT EXISTS app.recordings (
    Timestamp DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    TraceId String CODEC(ZSTD(1)),
    SpanId String CODEC(ZSTD(1)),
    TraceFlags UInt8,
    SeverityText LowCardinality(String) CODEC(ZSTD(1)),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String) CODEC(ZSTD(1)),
    Body String CODEC(ZSTD(1)),
    ResourceSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ResourceAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    ResourceAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
    ScopeSchemaUrl LowCardinality(String) CODEC(ZSTD(1)),
    ScopeName String CODEC(ZSTD(1)),
    ScopeVersion LowCardinality(String) CODEC(ZSTD(1)),
    ScopeAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    ScopeAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
    LogAttributes JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    LogAttributesKeys Array(LowCardinality(String)) CODEC(ZSTD(1)),
    EventName String CODEC(ZSTD(1)),
    tenant_id LowCardinality(String) MATERIALIZED toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) CODEC(ZSTD(1)),
    retention_days UInt16 MATERIALIZED everrRetentionDaysJson(ResourceAttributes),
    session_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'session.id')) CODEC(ZSTD(1)),
    stream_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')) CODEC(ZSTD(1)),
    clip_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id')) CODEC(ZSTD(1)),
    INDEX idx_session_id session_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_stream_id stream_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_clip_id clip_id TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, ServiceName, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

GRANT INSERT ON app.recordings TO collector_rw;
