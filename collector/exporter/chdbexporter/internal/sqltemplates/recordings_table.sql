-- Segments are close to 1 MB a row, so the granule holds 32 rows, not 8192:
-- one granule is then tens of megabytes, not gigabytes. stream_id leads the
-- key because a reader always asks for one Stream, in time order.
--
-- session_id, stream_id and segment_index are MATERIALIZED from attributes the
-- browser sent. Their expressions must never throw, because one row with a
-- missing or malformed attribute would fail the insert of its whole batch.
-- A malformed row gets '' and 0 instead.
CREATE TABLE IF NOT EXISTS {{ident .Database}}.{{ident .TableName}} {{.ClusterString}} (
    `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
    `TraceId` String CODEC(ZSTD(1)),
    `SpanId` String CODEC(ZSTD(1)),
    `TraceFlags` UInt8,
    `SeverityText` LowCardinality(String) CODEC(ZSTD(1)),
    `SeverityNumber` UInt8,
    `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
    `Body` String CODEC(ZSTD(1)),
    `ResourceSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
    `ResourceAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    `ResourceAttributesKeys` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `ScopeSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
    `ScopeName` String CODEC(ZSTD(1)),
    `ScopeVersion` LowCardinality(String) CODEC(ZSTD(1)),
    `ScopeAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    `ScopeAttributesKeys` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `LogAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
    `LogAttributesKeys` Array(LowCardinality(String)) CODEC(ZSTD(1)),
    `EventName` String CODEC(ZSTD(1)),

    `session_id` String MATERIALIZED toString(getSubcolumn(LogAttributes, 'session.id')),
    `stream_id` String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')),
    `segment_index` UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')))
) ENGINE = {{.Engine}}
PARTITION BY toDate(Timestamp)
ORDER BY (stream_id, Timestamp, segment_index)
{{.TTL}}
SETTINGS index_granularity = 32, ttl_only_drop_parts = 1
