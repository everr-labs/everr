-- Adaptive cadence (opt-in via spec.max_interval_secs): the rule's current
-- stretched evaluation interval in seconds; 0 = not stretched (evaluate at
-- spec.interval_secs). Written by the evaluator with each eval batch
-- (PgStore::persist_eval_batch) and read by the scheduler claim paths, which
-- clamp it into [interval_secs, max_interval_secs] so stale values can never
-- slow a rule beyond its spec. The default keeps existing rows at base cadence
-- and old binaries simply ignore the column (rolling-upgrade safe).
ALTER TABLE rules ADD COLUMN eval_backoff_secs INT NOT NULL DEFAULT 0;
