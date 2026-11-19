-- Browser recording Segments land here via the collector's
-- clickhouse/recordings exporter (direct insert, create_schema: false).
-- The columns match 0013-cloud-create-recordings.sql, which Cloud applies, so
-- one reader serves both products. This file has no tenant row policy because
-- self-hosted has none.
--
-- MATERIALIZED columns stamp tenant, retention, and Segment ids at insert.
-- tenant_id is empty when the collector stamps no tenant. The expression
-- yields '' for a missing path, so it does not throw.
--
-- session_id, stream_id, and segment_index come from client-sent log
-- attributes, so their MATERIALIZED expressions must never throw: one row
-- with a missing or malformed attribute would fail the exporter's whole
-- insert batch and back up the queue. Malformed rows get total fallback
-- values ('' and 0). The retention_days check stays a throwIf because the
-- collector sets that attribute itself.
--
-- sql_api_role gets no GRANT: recordings hold raw rrweb, and the SQL API reads
-- only the tables it was granted in 0010-self-hosted-create-sql-api-role.sql.
-- app_ro reads it through its existing SELECT ON app.*.

CREATE TABLE IF NOT EXISTS app.recordings
(
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

    tenant_id LowCardinality(String) MATERIALIZED toLowCardinality(toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id'))),
    retention_days UInt16 MATERIALIZED everrRetentionDaysJson(ResourceAttributes),
    session_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'session.id')),
    stream_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')),
    segment_index UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')))
)
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, stream_id, Timestamp, segment_index)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 32, ttl_only_drop_parts = 1;

GRANT INSERT ON app.recordings TO collector_rw;
