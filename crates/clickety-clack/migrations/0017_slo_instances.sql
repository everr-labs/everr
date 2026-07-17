-- Per-(SLO, tier, group) alert-instance state, mirroring `instances` but owned
-- by SLOs. Kept separate so the rule pipeline's hot path and FK are untouched.
CREATE TABLE slo_instances (
    key          TEXT PRIMARY KEY,
    slo          UUID NOT NULL REFERENCES slos(id) ON DELETE CASCADE,
    tenant       TEXT NOT NULL,
    status       TEXT NOT NULL,
    labels       JSONB NOT NULL,
    value        DOUBLE PRECISION,
    active_since TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    absent_count INT NOT NULL DEFAULT 0
);
CREATE INDEX slo_instances_slo_idx ON slo_instances (slo);
CREATE INDEX slo_instances_tenant_status_idx ON slo_instances (tenant, status);
