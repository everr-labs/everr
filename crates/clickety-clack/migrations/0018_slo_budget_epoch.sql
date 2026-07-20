-- Precise "budget epoch": when the SLO's error budget last began — creation, or
-- the last edit that changed a BUDGET-SIGNIFICANT field (sli / targetPercent /
-- timeWindow). Distinct from `updated_at`, which also bumps on pause/resume and
-- on non-significant spec edits (name, tiers, annotations). The error-budget
-- chart uses it to split reconstructed (pre-epoch) history from the real
-- (post-epoch) budget: everything left of this instant is inferred from raw
-- telemetry that predates the objective, not observed under it.
--
-- Existing rows seed from created_at: their budget has existed since creation,
-- and any later significant edit is unknown, so creation is the safe lower bound.
ALTER TABLE slos ADD COLUMN budget_epoch TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE slos SET budget_epoch = created_at;
