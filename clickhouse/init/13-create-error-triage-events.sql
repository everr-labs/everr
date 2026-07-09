-- Error triage events (Investigations, Resolutions, status changes; ADR 0004).
-- Canonical content lives here. Only metadata markers are projected into
-- app.logs below: bodies and author identity never leave this table, so
-- erasure and rectification stay a mutation on this small table only.
--
-- Updates and deletes are append-only version rows: same (tenant_id,
-- fingerprint, event_id) with a higher version. ReplacingMergeTree keeps the
-- highest version at merge time and physically drops superseded rows, which
-- is what makes erasure cheap; reads still resolve the latest version
-- explicitly (argMax) because merges are eventual.

CREATE TABLE IF NOT EXISTS app.error_triage_events
(
  -- String, not UUID: application organization ids are text (see alert_events).
  tenant_id String,
  fingerprint String,
  -- Identity of the logical entry; versions of one entry share it.
  event_id UUID,
  -- Bumped on every edit or delete of the entry. 0 = as created.
  version UInt32 DEFAULT 0,
  -- investigation | resolved | ignored | reopened
  event_type LowCardinality(String),
  -- Markdown, as written. Emptied when deleted = 1.
  body String,
  -- Author user id only; display name and avatar resolve from the user
  -- profile at read time, so a rename or account erasure needs no row change.
  author_id String,
  deleted UInt8 DEFAULT 0,
  -- Original creation time of the entry: the timeline order key. Versions
  -- MUST reuse it verbatim; it also pins all versions of an entry into the
  -- same partition, which ReplacingMergeTree needs to collapse them.
  event_time DateTime64(3),
  updated_at DateTime64(3) DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(toDate(event_time))
-- Dominant read: full timeline for one Error, then entry lookup for
-- edit/delete. The tuple is also the ReplacingMergeTree dedup key.
ORDER BY (tenant_id, fingerprint, event_id)
-- No TTL on purpose: triage knowledge is small, human-written, and a
-- Resolution must outlive the log retention window.
SETTINGS index_granularity = 8192;

GRANT SELECT ON app.error_triage_events TO app_ro;
GRANT INSERT, SELECT ON app.error_triage_events TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_error_triage_events ON app.error_triage_events;
CREATE ROW POLICY tenant_filter_error_triage_events
ON app.error_triage_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- Metadata-only projection into app.logs: agents querying the logs surface
-- can discover triage activity (and pivot to the errors read surface for
-- content), but the projection carries no body and no author, so rows copied
-- into the immutable logs table never need redaction. Every version insert
-- projects, so edits and deletes appear as their own audit markers.
CREATE MATERIALIZED VIEW IF NOT EXISTS app.error_triage_events_logs_mv
TO app.logs
AS
SELECT
  toDateTime64(updated_at, 9) AS Timestamp,
  toDateTime(updated_at) AS TimestampTime,
  '' AS TraceId,
  '' AS SpanId,
  toUInt8(0) AS TraceFlags,
  'INFO' AS SeverityText,
  toUInt8(9) AS SeverityNumber,
  'error-triage' AS ServiceName,
  concat(
    'error ',
    event_type,
    ' ',
    multiIf(deleted = 1, 'deleted', version > 0, 'edited', 'recorded')
  ) AS Body,
  '' AS ResourceSchemaUrl,
  map('everr.tenant.id', tenant_id) AS ResourceAttributes,
  '' AS ScopeSchemaUrl,
  'everr.errors' AS ScopeName,
  '' AS ScopeVersion,
  map() AS ScopeAttributes,
  map(
    'everr.error.event', event_type,
    'everr.error.fingerprint', fingerprint,
    'everr.error.action', multiIf(deleted = 1, 'deleted', version > 0, 'edited', 'recorded')
  ) AS LogAttributes,
  concat('everr.error.', event_type) AS EventName,
  -- Required for app.logs RLS and TTL; ResourceAttributes alone is not enough.
  tenant_id AS tenant_id
FROM app.error_triage_events;
