-- Segments are close to 1 MB a row, so the granule holds 32 rows, not 8192:
-- one granule is then tens of megabytes, not gigabytes.
--
-- Keep the columns, the expressions and the keys in step with the cloud's
-- packages/app/clickhouse/0013-create-recordings.sql. The local table has no
-- tenant_id and no retention_days, so its keys start at the hour, and its TTL
-- is the exporter's `ttl`.
--
-- The MATERIALIZED columns come from attributes the browser sent. Their
-- expressions must never throw, because one row with a missing or malformed
-- attribute would fail the insert of its whole batch. A malformed row gets
-- '', 0, false or the epoch instead (see everrUnixMilliOrEpoch).
--
-- The sort key holds the hour of Timestamp and not Timestamp itself: with the
-- raw column in the key a filter on Timestamp binds to that column and the hour
-- bucket prunes nothing. The 'UTC' is explicit in the partition, the key and
-- the TTL, because without it each follows the session time zone.
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
    `segment_index` UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index'))),
    `segment_end` DateTime64(3) MATERIALIZED everrUnixMilliOrEpoch(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.end'))),
    `clip_start` DateTime64(3) MATERIALIZED everrUnixMilliOrEpoch(toString(getSubcolumn(LogAttributes, 'everr.recording.clip.start'))),
    `clip_id` String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id')),
    `trigger` LowCardinality(String) MATERIALIZED toLowCardinality(toString(getSubcolumn(LogAttributes, 'everr.recording.trigger'))),
    `truncated` Bool MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.clip.truncated')) = 'true'
) ENGINE = {{.Engine}}
PARTITION BY toDate(Timestamp, 'UTC')
ORDER BY (toStartOfHour(Timestamp, 'UTC'), stream_id, segment_index)
{{.TTL}}
SETTINGS index_granularity = 32, ttl_only_drop_parts = 1
