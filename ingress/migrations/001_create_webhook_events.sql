-- ingress/migrations/001_create_webhook_events.sql

CREATE TABLE webhook_events (
    id            BIGSERIAL PRIMARY KEY,
    source        TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    body_sha256   TEXT NOT NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    headers       JSONB NOT NULL,
    body          BYTEA NOT NULL,

    status        TEXT NOT NULL DEFAULT 'queued',
    attempts      INT NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until  TIMESTAMPTZ,
    last_error    TEXT,
    error_class   TEXT,
    done_at       TIMESTAMPTZ,
    dead_at       TIMESTAMPTZ,

    UNIQUE (source, event_id)
);

CREATE INDEX webhook_events_claim_idx
  ON webhook_events (next_attempt_at, received_at)
  WHERE status IN ('queued', 'failed');

CREATE INDEX webhook_events_dead_idx
  ON webhook_events (dead_at)
  WHERE status = 'dead';
