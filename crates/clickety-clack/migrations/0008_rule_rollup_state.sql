-- Rule-level rolled-up alert state, mirroring everr's old alert_definitions.
-- Written in the SAME transaction as instance-state by the evaluator
-- (PgStore::persist_eval_batch), so the rollup never lags committed instance state.
ALTER TABLE rules ADD COLUMN alert_state           TEXT        NOT NULL DEFAULT 'inactive';
ALTER TABLE rules ADD COLUMN firing_instance_count INT         NOT NULL DEFAULT 0;
ALTER TABLE rules ADD COLUMN last_fired_at         TIMESTAMPTZ;
ALTER TABLE rules ADD COLUMN last_resolved_at      TIMESTAMPTZ;
ALTER TABLE rules ADD COLUMN last_seen_at          TIMESTAMPTZ;
ALTER TABLE rules ADD COLUMN last_row_count        INT         NOT NULL DEFAULT 0;

-- Cheap lookup of currently-firing rules for the simple-alert list badge.
CREATE INDEX rules_alert_state_idx ON rules (tenant, alert_state);
