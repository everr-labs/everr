-- Operational pause flag for rules. Default false preserves existing behavior.
ALTER TABLE rules ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false;

-- Keep the scheduler's due-rule scan lean now that it also filters on `paused`.
CREATE INDEX rules_next_eval_active_idx ON rules (next_eval) WHERE NOT paused;
