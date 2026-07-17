-- SLO evaluation: scheduling column, health axis, status snapshot, idempotency.

-- Scheduling (mirrors rules.next_eval). Jitter offset applied by the app on arm.
ALTER TABLE slos ADD COLUMN next_eval TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX slos_due_idx ON slos (next_eval) WHERE NOT paused;

-- Health axis (mirrors the rules health columns). Degraded events are Plan 3;
-- Plan 2 only records the state.
ALTER TABLE slos ADD COLUMN health_status        TEXT NOT NULL DEFAULT 'healthy';
ALTER TABLE slos ADD COLUMN consecutive_failures INT  NOT NULL DEFAULT 0;
ALTER TABLE slos ADD COLUMN degraded_since       TIMESTAMPTZ;
ALTER TABLE slos ADD COLUMN last_error           TEXT;
ALTER TABLE slos ADD COLUMN last_error_at        TIMESTAMPTZ;

-- One status snapshot per SLO. `payload` holds per-group status + per-window
-- freshness timestamps (see Task 8/9 for its shape). Cascade with the SLO.
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
