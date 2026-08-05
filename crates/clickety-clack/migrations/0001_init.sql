-- Consolidated initial schema for the clickety-clack engine.
--
-- The engine has never been deployed, so the incremental migration history was
-- collapsed into this single init. Every table below reflects the final state
-- of the pre-collapse 0001..0019 sequence; the historical backfills are dropped
-- because there is no data to migrate.

-- Alert rules: per-tenant, spec stored as JSONB. Carries scheduling
-- (`next_eval`), a health axis, a rolled-up alert state written in the same
-- transaction as instance state, adaptive-cadence backoff, and first-class
-- identity (`namespace`/`name`, unique per tenant).
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
    paused      BOOLEAN NOT NULL DEFAULT false,
    alert_state           TEXT        NOT NULL DEFAULT 'inactive',
    firing_instance_count INT         NOT NULL DEFAULT 0,
    last_fired_at         TIMESTAMPTZ,
    last_resolved_at      TIMESTAMPTZ,
    last_seen_at          TIMESTAMPTZ,
    last_row_count        INT         NOT NULL DEFAULT 0,
    eval_backoff_secs INT NOT NULL DEFAULT 0,
    namespace   TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX rules_due_idx ON rules (next_eval);
CREATE INDEX rules_tenant_idx ON rules (tenant);
CREATE INDEX rules_next_eval_active_idx ON rules (next_eval) WHERE NOT paused;
CREATE INDEX rules_alert_state_idx ON rules (tenant, alert_state);
CREATE UNIQUE INDEX rules_tenant_ns_name_idx ON rules (tenant, namespace, name);

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
-- `eval_ts` is the PK's trailing column, so the hourly retention prune
-- (`WHERE eval_ts < cutoff`) needs its own index to avoid scanning the whole ledger.
CREATE INDEX evaluations_eval_ts_idx ON evaluations (eval_ts);

CREATE TABLE notifications (
    dedup_key   TEXT PRIMARY KEY,
    tenant      TEXT NOT NULL,
    channel     TEXT NOT NULL,
    target      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
    attempts    INT NOT NULL DEFAULT 0,            -- delivery retries of one send
    claims      INT NOT NULL DEFAULT 0,            -- senders that have owned this row
    last_error  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_tenant_idx ON notifications (tenant);
CREATE INDEX notifications_status_idx ON notifications (status);
-- Serves the hourly retention prune (`WHERE updated_at < cutoff`); every other read of
-- this table goes through the `dedup_key` primary key.
CREATE INDEX notifications_updated_at_idx ON notifications (updated_at);

-- A receiver is a named set of channel references (see `receiver_channels`).
-- Free-form `annotations` default to an empty map. Names are mutable labels:
-- everything that points at a receiver does so by id, so a rename touches one
-- row. The extra `(tenant, id)` unique constraint exists so referencing tables
-- can carry the tenant in their foreign keys, making a cross-tenant reference
-- unrepresentable at the schema level; its index (like the `(tenant, name)`
-- one) is tenant-prefixed, so tenant-scoped reads need no index of their own.
CREATE TABLE receivers (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    name        TEXT NOT NULL,
    annotations JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant, name),
    UNIQUE (tenant, id)
);

-- Channels: standalone secret-bearing endpoint configs, unique by (tenant, name)
-- and referenced by id from `receiver_channels`. `(tenant, id)` as on `receivers`.
CREATE TABLE channels (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    name        TEXT NOT NULL,
    config      JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant, name),
    UNIQUE (tenant, id)
);

-- The receiver -> channel references. Real foreign keys do the integrity work:
-- a receiver cannot link a channel that does not exist, deleting a receiver
-- drops its links, and deleting a channel a receiver still uses is rejected
-- (the API turns that into a 409 naming the referrers). Both keys carry the
-- tenant, so a link can never cross tenants. `position` preserves the caller's
-- channel order.
CREATE TABLE receiver_channels (
    tenant      TEXT NOT NULL,
    receiver_id UUID NOT NULL,
    channel_id  UUID NOT NULL,
    position    INT  NOT NULL,
    PRIMARY KEY (receiver_id, channel_id),
    FOREIGN KEY (tenant, receiver_id) REFERENCES receivers (tenant, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant, channel_id)  REFERENCES channels (tenant, id)
);
-- Postgres does not index the referencing side of a foreign key; this covers the
-- channel-delete FK check and the in-use lookup that names referrers in the 409.
CREATE INDEX receiver_channels_channel_idx ON receiver_channels (channel_id);

-- Routes target a receiver by id: a route pointing at a receiver that does not
-- exist is rejected, and a receiver a route still targets cannot be deleted
-- (without that, a stranded route silently drops every alert it matches).
-- The API speaks receiver names; the store resolves them at write time and
-- joins them back at read time, so renames never touch this table.
CREATE TABLE routes (
    id                UUID PRIMARY KEY,
    tenant            TEXT NOT NULL,
    matchers          JSONB NOT NULL,
    receiver_id       UUID NOT NULL,
    continue_matching BOOLEAN NOT NULL DEFAULT false,
    priority          INT NOT NULL DEFAULT 0,
    group_by            JSONB,
    group_wait_secs     INT,
    group_interval_secs INT,
    repeat_interval_secs INT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (tenant, receiver_id) REFERENCES receivers (tenant, id)
);
-- Covers the receiver-delete FK check and the in-use lookup that names the
-- referring routes in a 409. Tenant-only reads use it as a prefix.
CREATE INDEX routes_tenant_receiver_idx ON routes (tenant, receiver_id);

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

-- SLOs: first-class per-tenant resource, mirroring `rules`. Spec is JSONB.
-- `name`/`namespace` are the as-code address, unique per (tenant, namespace,
-- name). Carries the same scheduling + health axis as rules, plus `budget_epoch`
-- (when the error budget last began, distinct from `updated_at`).
CREATE TABLE slos (
    id          UUID PRIMARY KEY,
    tenant      TEXT NOT NULL,
    namespace   TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    spec        JSONB NOT NULL,
    version     BIGINT NOT NULL DEFAULT 1,
    paused      BOOLEAN NOT NULL DEFAULT false,
    next_eval   TIMESTAMPTZ NOT NULL DEFAULT now(),
    health_status        TEXT NOT NULL DEFAULT 'healthy',
    consecutive_failures INT  NOT NULL DEFAULT 0,
    degraded_since       TIMESTAMPTZ,
    last_error           TEXT,
    last_error_at        TIMESTAMPTZ,
    budget_epoch TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slos_tenant_idx ON slos (tenant);
CREATE INDEX slos_due_idx ON slos (next_eval) WHERE NOT paused;
CREATE UNIQUE INDEX slos_tenant_ns_name_idx ON slos (tenant, namespace, name);

-- One status snapshot per SLO. `payload` holds per-group status + per-window
-- freshness timestamps (see engine::slo_math::SloStatusPayload for its shape).
CREATE TABLE slo_status (
    slo         UUID PRIMARY KEY REFERENCES slos(id) ON DELETE CASCADE,
    tenant      TEXT NOT NULL,
    payload     JSONB NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX slo_status_tenant_idx ON slo_status (tenant);

-- Idempotency ledger for SLO evaluations (mirrors `evaluations`; bare UUID).
CREATE TABLE slo_evaluations (
    slo        UUID NOT NULL,
    eval_ts    TIMESTAMPTZ NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (slo, eval_ts)
);
CREATE INDEX slo_evaluations_eval_ts_idx ON slo_evaluations (eval_ts);

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
