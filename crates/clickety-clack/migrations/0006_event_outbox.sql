-- Transactional event outbox. A row is written in the same transaction as the
-- instance state change, then deleted on successful publish. The relay re-publishes
-- any row that outlives the grace window (publish errored or process crashed).
CREATE TABLE event_outbox (
    id         UUID PRIMARY KEY,
    tenant     TEXT NOT NULL,
    payload    JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relay scans oldest-first for rows past the grace window.
CREATE INDEX event_outbox_created ON event_outbox (created_at);
