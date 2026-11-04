-- Cloud-only: browser recording Segments land here via the collector's
-- clickhouse/recordings exporter (direct insert, create_schema: false).
-- Not created on self-hosted. Existing Cloud clusters apply the same statements
-- from clickhouse/manual/recordings.sql once.
--
-- MATERIALIZED columns stamp tenant, retention, and Segment ids at insert.
-- There is no clip_id: overlapping Clips share Segment bodies; membership is
-- the recording span's stream id plus time range (see packages/app replay).
-- ResourceAttributes keeps everr.retention.days so retention_days can read it
-- (SKIP would remove the path before the expression runs).

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
    session_id String MATERIALIZED substringUTF8(
        toString(getSubcolumn(LogAttributes, 'session.id')),
        1,
        lengthUTF8(toString(getSubcolumn(LogAttributes, 'session.id')))
            + throwIf(
                toString(getSubcolumn(LogAttributes, 'session.id')) = '',
                'session.id log attribute missing'
              )
    ),
    stream_id String MATERIALIZED substringUTF8(
        toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')),
        1,
        lengthUTF8(toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')))
            + throwIf(
                toString(getSubcolumn(LogAttributes, 'everr.recording.stream.id')) = '',
                'everr.recording.stream.id log attribute missing'
              )
    ),
    segment_index UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')))
        + throwIf(
            toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')) = ''
                OR toString(toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index'))))
                    != toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index')),
            'everr.recording.segment.index missing or not a non-negative integer'
          ),

    INDEX idx_session_id session_id TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_stream_id stream_id TYPE bloom_filter(0.001) GRANULARITY 1
)
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, stream_id, Timestamp, segment_index)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 32, ttl_only_drop_parts = 1;

GRANT INSERT ON app.recordings TO collector_rw;

-- Row policies for clusters that already ran init (fresh installs get these
-- from 15-create-sql-api-role.sql and 20-apply-rls.sql).

CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

DROP ROW POLICY IF EXISTS tenant_filter_recordings ON app.recordings;
CREATE ROW POLICY tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
