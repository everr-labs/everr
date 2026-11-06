-- Cloud-only, for clusters that already ran the older init. The CREATE TABLE
-- block below must stay byte-identical with
-- clickhouse/init/cloud/14-create-recordings.sql (fresh clusters take the DDL
-- from there; this file exists so an existing cluster can apply it once).
-- Edit 14-create-recordings.sql first, then copy its CREATE TABLE block here.
--
-- Operator notes beyond the DDL:
-- 1. Residual Segment rows: if this cluster ever ingested recording Segments
--    into app.logs before the routing cutover, those rows are still readable
--    by SQL API org users whose row policies were created before the
--    `EventName != 'everr.browser.recording.segment'` filter existed (see
--    packages/cloud/src/clickhouse/provisioning.ts). Clean them up once:
--      ALTER TABLE app.logs DELETE WHERE EventName = 'everr.browser.recording.segment';
-- 2. Existing policies: provisioning used CREATE ROW POLICY IF NOT EXISTS, so
--    the logs policy of an existing SQL API org user still uses the old
--    USING clause. Provisioning now runs CREATE ROW POLICY OR REPLACE; run it
--    again for the affected organizations, or fix them once with:
--      -- list the stale policies:
--      SELECT policy.name, policy.source, user.name
--      FROM system.row_policies AS policy LEFT JOIN system.users AS user
--      ON user.id = policy.user_id
--      WHERE policy.table = 'logs' AND policy.name LIKE 'org_SQL%'
--      -- then per policy:
--      ALTER ROW POLICY <policy.name> ON app.logs
--      FOR SELECT USING tenant_id = <tenant literal>
--        AND EventName != 'everr.browser.recording.segment'
--      TO <user.name>
--
-- The CREATE TABLE block matches clickhouse/init/cloud/14-create-recordings.sql.

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
