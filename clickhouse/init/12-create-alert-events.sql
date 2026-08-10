-- The column reference lives in the alerting surface design doc and must stay
-- in lockstep with it.
CREATE TABLE IF NOT EXISTS app.alert_events
(
  -- UUIDv7 on non-delivery rows, so UUIDv7ToDateTime(event_id) recovers the
  -- creation time and equals the PostgreSQL journal row it projects. Delivery
  -- rows carry a deterministic id derived from the journal event and
  -- delivery_dedup_key, so reconciliation repair is idempotent.
  event_id UUID DEFAULT generateUUIDv7(),
  -- Correlates the rows produced by one notification: the transition and the
  -- suppression or delivery rows that follow it in later jobs. Transitions set
  -- this to their own event_id. Evaluation and lifecycle-only rows leave it
  -- zero.
  notification_event_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  -- One continuous breach of an instance: the pending or fired event's id,
  -- carried on every lifecycle row of that episode. Zero elsewhere.
  episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  tenant_id LowCardinality(String),
  alert_definition_id UUID,
  repoid LowCardinality(String),
  slug LowCardinality(String),
  preview_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  -- DEFAULT, not MATERIALIZED: a MATERIALIZED column is invisible to SELECT *,
  -- and nobody should have to type the zero-UUID sentinel to filter previews.
  is_live Bool DEFAULT preview_id = toUUID('00000000-0000-0000-0000-000000000000'),
  event_type LowCardinality(String),
  -- 'live' or 'reconciled'. The app.logs projection copies live rows only,
  -- which is what lets the reconciler re-drive rows without duplicating logs.
  write_source LowCardinality(String) DEFAULT 'live',
  -- Zero (epoch) off evaluation rows; never dateDiff against it there.
  evaluation_scheduled_at DateTime64(3) CODEC(Delta, ZSTD(1)),
  event_time DateTime64(3) DEFAULT now64(3) CODEC(Delta, ZSTD(1)),
  row_count UInt64 DEFAULT 0,
  evidence_truncated Bool DEFAULT false,
  evidence_json String DEFAULT '{}' CODEC(ZSTD(6)),
  samples_truncated Bool DEFAULT false,
  samples_json String DEFAULT '[]' CODEC(ZSTD(6)),
  -- Frozen agent-facing content on lifecycle rows, documented keys
  -- {summary, description, links: {runbook, alert}, condition}. Read-out
  -- facts, never predicates; predicates get typed columns.
  context_json String DEFAULT '{}' CODEC(ZSTD(6)),
  -- Sanitized at the write boundary: never a URL or token, because provider
  -- error text embeds webhook URLs and this table cannot forget.
  error String DEFAULT '',
  instance_fingerprint String DEFAULT '',
  instance_labels Map(LowCardinality(String), String) DEFAULT map(),
  -- Resolved at write time: an instance label naming a service, else 'alert'.
  service_name LowCardinality(String) DEFAULT 'alert',
  -- Validated at the spec boundary, not here: an Enum would make the
  -- non-throwing writer drop rows when a severity is added.
  severity LowCardinality(String) DEFAULT 'info',
  -- The rule never notifies at all (spec.suppressed or a preview copy). Set
  -- on every row; unrelated to `silenced`, which is per notification.
  rule_muted Bool DEFAULT false,
  -- On terminal instance rows: condition_cleared on instance_resolved;
  -- pending_cleared, labels_changed, rule_paused, rule_deleted or
  -- preview_deleted on instance_closed; rule_paused, rule_deleted,
  -- no_longer_firing or no_channels on a terminal notification_suppressed.
  -- The closed vocabulary lives in ALERTING_LIFECYCLE_REASONS
  -- (src/data/alerting/vocabulary.ts).
  reason LowCardinality(String) DEFAULT '',
  -- Notification outcome, frozen at the moment it was decided. A silence
  -- created later never rewrites what these say happened. Meaningful only on
  -- notification_deferred and notification_suppressed rows.
  silenced Bool DEFAULT false,
  inhibited Bool DEFAULT false,
  silence_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  -- Frozen from the silence so the row reads without PostgreSQL: the id alone
  -- is a dead end for a one-endpoint caller.
  silence_comment String DEFAULT '',
  silence_matchers_json String DEFAULT '',
  -- The inhibiting source, frozen like the silence: without it,
  -- inhibited = true is the id-only dead end the silence freeze exists to
  -- prevent. Written from the suppression job once inhibition freezing lands.
  inhibition_comment String DEFAULT '',
  inhibition_source_json String DEFAULT '',
  -- Channel type to the channel names it reached. Denormalized so a delivery
  -- trail never needs a join back to PostgreSQL. Never carries a URL, token,
  -- or address: see deliveryTargets in delivery/history.ts.
  delivery_targets Map(String, Array(String)) DEFAULT map(),
  -- The PostgreSQL delivery key; the reconciliation diff joins on it. Empty
  -- off delivery rows.
  delivery_dedup_key String DEFAULT '',
  INDEX alert_def_skip_idx alert_definition_id TYPE bloom_filter GRANULARITY 4,
  INDEX alert_notification_skip_idx notification_event_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
-- The second dimension keeps every query on transitions, holds or deliveries,
-- and every reconciliation diff, off the evaluation rows, which outnumber
-- everything else by two orders of magnitude. Partitioning on event_time
-- itself (not a date column) is what lets a plain event_time bound prune:
-- ClickHouse does not infer a DEFAULT relation between two columns.
PARTITION BY (toYYYYMM(event_time), event_type IN ('evaluation_succeeded', 'evaluation_failed'))
-- Dominant read: per-alert history by tenant + repoid + slug over a time range.
-- ORDER BY is immutable, so this intentionally prioritizes alert filters over
-- date-only scans. event_type is low-cardinality and filtered in every query,
-- so it sits before the time column. alert_definition_id and
-- notification_event_id are high-cardinality and covered by bloom skip
-- indexes instead.
ORDER BY (tenant_id, repoid, slug, event_type, event_time, event_id)
-- Evaluation rows expire at min(30, tenant retention) days: they exist for
-- staleness and rule-health reads, and their partitions drop whole. Everything
-- else lives at the tenant retention.
TTL toDateTime(event_time) + INTERVAL least(toUInt32(30), dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650))) DAY DELETE WHERE event_type IN ('evaluation_succeeded', 'evaluation_failed'),
    toDateTime(event_time) + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650)) DAY DELETE WHERE event_type NOT IN ('evaluation_succeeded', 'evaluation_failed')
-- The deduplication window is sized now, at recreation time. recordAlertHistoryStrict
-- (server/alerts/history/clickhouse.ts) sets insert_deduplication_token today,
-- synchronously, for the lifecycle projection's Graphile retries; the live
-- best-effort path and the reconciler (when it lands) still need their own
-- token scheme.
-- allow_suspicious_ttl_expressions rides the statement, not the session, so
-- SHOW CREATE matches migrated deployments.
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 10000, allow_suspicious_ttl_expressions = 1;

GRANT SELECT ON app.alert_events TO app_ro;
GRANT INSERT, SELECT ON app.alert_events TO web_app_admin;
GRANT dictGet ON app.tenant_retention TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;
CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
