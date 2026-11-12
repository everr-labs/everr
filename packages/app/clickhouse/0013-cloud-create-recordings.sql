-- Browser recording Segments land here via the collector's
-- clickhouse/recordings exporter (direct insert, create_schema: false).
-- Not created on self-hosted.
--
-- MATERIALIZED columns stamp tenant, retention, and Segment ids at insert.
-- There is no clip_id: overlapping Clips share Segment bodies; membership is
-- the recording span's stream id plus time range (see packages/app replay).
-- ResourceAttributes keeps everr.retention.days so retention_days can read it
-- (SKIP would remove the path before the expression runs).
--
-- session_id, stream_id, and segment_index come from client-sent log
-- attributes, so their MATERIALIZED expressions must never throw: one row
-- with a missing or malformed attribute would fail the exporter's whole
-- insert batch, and with retries of 0s max elapsed time the queue would back
-- up for every tenant. Malformed rows get total fallback values ('' and 0)
-- and the reader never selects them outside a known stream id (see
-- packages/app replay). The retention_days check stays a throwIf because the
-- collector sets that attribute itself.
--
-- No secondary indexes: stream_id is the ORDER BY's second column (the reader
-- always filters by stream id and tenant), and nothing in the product queries
-- recordings by session_id (the replay reader matches sessions through the
-- `recording` span, not through these rows).

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

-- app_ro already has SELECT ON app.*, so the tenant filter must exist as soon
-- as the table does. Without it, reads are cross-tenant.
CREATE ROW POLICY OR REPLACE tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- Recordings hold raw rrweb. Deny by default and never GRANT SELECT so an
-- accidental grant later stays fail-closed. Not in SQL_API_TABLES.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

GRANT INSERT ON app.recordings TO collector_rw;
