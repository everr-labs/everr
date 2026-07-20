-- Migration: create the SLO error-budget UDFs on an existing cluster.
--
-- init/05-create-slo-functions.sql runs only on a fresh server, so an already
-- provisioned cluster (dev, prod) needs this one-off. Idempotent
-- (CREATE OR REPLACE FUNCTION), safe to re-run.
--
-- Keep in step with clickhouse/init/05-create-slo-functions.sql and the engine's
-- canonical implementation in crates/clickety-clack/src/engine/slo_math.rs.
-- Parity anchor: sloBurnRate(9856, 10000, 99.9) = 14.4
--
-- Apply with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/migrate-slo-functions.sql

CREATE OR REPLACE FUNCTION sloBurnRate AS (good, valid, target) ->
  if(
    valid <= 0 OR target >= 100,
    NULL,
    greatest(0, least(1, 1 - good / valid)) / ((100 - target) / 100)
  );

CREATE OR REPLACE FUNCTION sloBudgetRemaining AS (good, valid, target) ->
  1 - sloBurnRate(good, valid, target);
