CREATE TABLE receivers (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    name        TEXT NOT NULL,
    channel     JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant, name)
);
CREATE INDEX receivers_tenant_idx ON receivers (tenant);

CREATE TABLE routes (
    id                UUID PRIMARY KEY,
    tenant            TEXT NOT NULL,
    matchers          JSONB NOT NULL,
    receiver          TEXT NOT NULL,
    continue_matching BOOLEAN NOT NULL DEFAULT false,
    priority          INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX routes_tenant_idx ON routes (tenant);
