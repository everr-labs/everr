-- sloBurnRate / sloBudgetRemaining: Everr's SLO error-budget math as ClickHouse
-- UDFs, so the burn rate and remaining budget are derived at read time from the
-- raw (good, valid) counts the clickety-clack engine records into
-- app.metrics_gauge, rather than every SLO surface (detail chart, list,
-- dashboards, ad-hoc `everr cloud query`) carrying its own copy of the formula.
--
-- These MUST stay in step with the engine's canonical implementation in
-- crates/clickety-clack/src/engine/slo_math.rs:
--   error_budget_fraction(target) = (100 - target) / 100
--   window_bad_ratio(good, valid) = NULL when valid <= 0, else clamp(1 - good/valid, 0, 1)
--   burn_rate                     = NULL when no traffic or no budget, else bad_ratio / budget
--   budget_remaining              = 1 - burn_rate  (may go negative when overspent)
-- Parity anchor (slo_math.rs `burn_rate_canonical_example`):
--   sloBurnRate(9856, 10000, 99.9) = 14.4
--
-- init/ runs only on a fresh server. Apply to an existing cluster with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/init/05-create-slo-functions.sql

-- Normalized burn rate: observed bad ratio over the window as a multiple of the
-- error budget. NULL at zero traffic (valid <= 0) or when there is no budget to
-- spend (target >= 100), matching the engine's `None` in both cases. The bad
-- ratio is clamped to [0, 1] exactly as `window_bad_ratio` does.
CREATE OR REPLACE FUNCTION sloBurnRate AS (good, valid, target) ->
  if(
    valid <= 0 OR target >= 100,
    NULL,
    greatest(0, least(1, 1 - good / valid)) / ((100 - target) / 100)
  );

-- Fraction of the error budget still available over the window. NULL propagates
-- from sloBurnRate at zero traffic; may be negative once the objective is
-- exceeded (burn rate above 1x).
CREATE OR REPLACE FUNCTION sloBudgetRemaining AS (good, valid, target) ->
  1 - sloBurnRate(good, valid, target);
