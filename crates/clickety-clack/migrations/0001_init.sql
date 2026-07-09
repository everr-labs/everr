CREATE TABLE rules (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    spec        JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    next_eval   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_eval   TIMESTAMPTZ,
    last_error  TEXT,
    health_status        TEXT NOT NULL DEFAULT 'healthy',
    consecutive_failures INT  NOT NULL DEFAULT 0,
    degraded_since       TIMESTAMPTZ,
    last_error_at        TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rules_due_idx ON rules (next_eval);
CREATE INDEX rules_tenant_idx ON rules (tenant);

CREATE TABLE instances (
    key          TEXT PRIMARY KEY,
    rule         UUID NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    tenant       TEXT NOT NULL,
    status       TEXT NOT NULL,
    labels       JSONB NOT NULL,
    value        DOUBLE PRECISION,
    active_since TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    absent_count INT NOT NULL DEFAULT 0
);
CREATE INDEX instances_rule_idx ON instances (rule);
CREATE INDEX instances_tenant_status_idx ON instances (tenant, status);

-- Idempotency ledger: one row per (rule, eval_ts) actually applied.
CREATE TABLE evaluations (
    rule     UUID NOT NULL,
    eval_ts  TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    error    TEXT,
    PRIMARY KEY (rule, eval_ts)
);

CREATE TABLE subscriptions (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    webhook_url TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_tenant_idx ON subscriptions (tenant);
