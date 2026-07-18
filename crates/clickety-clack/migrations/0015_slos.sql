-- SLOs: first-class per-tenant resource, mirroring `rules`. Spec is JSONB.
-- Name is a first-class, per-tenant-unique column (as-code keying).
CREATE TABLE slos (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    name        TEXT NOT NULL,
    spec        JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    paused      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX slos_tenant_name_idx ON slos (tenant, name);
CREATE INDEX slos_tenant_idx ON slos (tenant);
