ALTER TABLE webhook_events
ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT 'collector',
ADD COLUMN IF NOT EXISTS tenant_id BIGINT;

ALTER TABLE webhook_events
DROP CONSTRAINT IF EXISTS webhook_events_source_event_id_key;

ALTER TABLE webhook_events
ADD CONSTRAINT webhook_events_source_event_id_topic_key UNIQUE (source, event_id, topic);
