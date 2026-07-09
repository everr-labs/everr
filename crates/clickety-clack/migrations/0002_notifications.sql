CREATE TABLE notifications (
    dedup_key   TEXT PRIMARY KEY,
    tenant      TEXT NOT NULL,
    channel     TEXT NOT NULL,
    target      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
    attempts    INT NOT NULL DEFAULT 0,
    last_error  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_tenant_idx ON notifications (tenant);
CREATE INDEX notifications_status_idx ON notifications (status);
