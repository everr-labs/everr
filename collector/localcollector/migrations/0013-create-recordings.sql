-- Browser recording Segments land here via the collector's
-- clickhouse/recordings exporter (direct insert, create_schema: false).
-- Both products create it. Cloud adds its row policies in
-- 0014-cloud-recordings-rls.sql. Self-hosted has none, and tenant_id is empty
-- when its collector stamps no tenant. The SQL API reads every column except
-- Body (0014 on Cloud, 0015-self-hosted-recordings-sql-api-grant.sql on
-- self-hosted): Body is raw rrweb, megabytes per row, and holds page text.
--
-- This table is the only place that knows about recordings. There is no
-- separate span: a Segment is one row, and it carries everything a reader
-- needs to place it.
--   * Timestamp is the time of the Segment's first event.
--   * A Segment says that its Stream is complete from clip_start through
--     segment_end, when every Segment with a lower index in that range
--     arrived. clip_start is the start of the run of overlapping Clips the
--     Segment was sent in, and where a replay of it starts.
--   * The Segments of one Stream with the same clip_start are one recording.
--   * The Clip facts (clip_id, trigger, truncated) are on the Segment that
--     opens a Clip and are empty on every other Segment. A Segment's Body is
--     [] when it only opens or closes a Clip.
-- ResourceAttributes keeps everr.retention.days so retention_days can read it
-- (SKIP would remove the path before the expression runs).
--
-- MATERIALIZED columns stamp tenant, retention, and the Segment facts at
-- insert. session_id, stream_id, segment_index, segment_end, clip_start,
-- clip_id, trigger, and truncated come from client-sent log attributes, so
-- their expressions must never throw: one row with a missing or malformed
-- attribute would fail the exporter's whole insert batch, and with retries of
-- 0s max elapsed time the queue would back up for every tenant. Malformed rows
-- get total fallback values ('', 0, false, and the epoch for a time that is
-- missing, not a number, or outside what DateTime64 can hold) and the reader
-- never selects them outside a known stream id (see packages/app replay). The
-- retention_days check stays a throwIf because the collector sets that
-- attribute itself.
--
-- The sort key holds the hour of Timestamp and not Timestamp itself. With the
-- raw column in the key, ClickHouse binds a filter on Timestamp to that column
-- and ignores the hour bucket (measured), and a Segment query does not need
-- the finer order: the hour narrows the range and segment_index orders the
-- rest. The hour is computed with an explicit 'UTC', as are the partition and
-- the TTL: without it each expression follows the session or server time zone,
-- so the same row would land in different buckets on two servers.
--
-- No secondary indexes: stream_id is the sort key's third column, after the
-- tenant and the hour, and the replay reader filters by stream id and a
-- Timestamp range. session_id is stored for SQL (list recordings of a
-- session), not indexed.

-- Unix milliseconds from a client-sent attribute (as text) to a DateTime64(3).
-- Total: a value that is not a number, is negative, or is past the end of the
-- DateTime64 range (2299-12-31) becomes the epoch instead of throwing or
-- wrapping.
CREATE OR REPLACE FUNCTION everrUnixMilliOrEpoch AS (raw) ->
  fromUnixTimestamp64Milli(
    toInt64(if(toFloat64OrZero(raw) BETWEEN 0 AND 10413791999999, toFloat64OrZero(raw), 0))
  );

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
    segment_index UInt32 MATERIALIZED toUInt32OrZero(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.index'))),
    segment_end DateTime64(3) MATERIALIZED everrUnixMilliOrEpoch(toString(getSubcolumn(LogAttributes, 'everr.recording.segment.end'))),
    clip_start DateTime64(3) MATERIALIZED everrUnixMilliOrEpoch(toString(getSubcolumn(LogAttributes, 'everr.recording.clip.start'))),
    clip_id String MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.clip.id')),
    trigger LowCardinality(String) MATERIALIZED toLowCardinality(toString(getSubcolumn(LogAttributes, 'everr.recording.trigger'))),
    truncated Bool MATERIALIZED toString(getSubcolumn(LogAttributes, 'everr.recording.clip.truncated')) = 'true'
)
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp, 'UTC'), retention_days)
ORDER BY (tenant_id, toStartOfHour(Timestamp, 'UTC'), stream_id, segment_index)
TTL toDate(Timestamp, 'UTC') + toIntervalDay(retention_days)
SETTINGS index_granularity = 32, ttl_only_drop_parts = 1;
