CREATE TABLE silences (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    matchers    JSONB NOT NULL,
    starts_at   TIMESTAMPTZ NOT NULL,
    ends_at     TIMESTAMPTZ NOT NULL,
    comment     TEXT NOT NULL DEFAULT '',
    author      TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX silences_tenant_ends ON silences (tenant, ends_at);

CREATE TABLE inhibitions (
    id              UUID PRIMARY KEY,
    tenant          TEXT NOT NULL,
    source_matchers JSONB NOT NULL,
    target_matchers JSONB NOT NULL,
    equal           JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inhibitions_tenant ON inhibitions (tenant);
