-- Per-row retention, expressed once. Every app.* materialized view reads the
-- window the collector stamped on the resource and strips the attribute before
-- storage; centralized as UDFs so the two rules live in one place instead of a
-- copy in each of the seven views.
--
-- everrRetentionDays refuses a row that carries no window. A missing attribute
-- would stamp 0 and the row would expire at insert with no error. Write it as
-- `toUInt16OrZero(x) + throwIf(x = '', ...)`, never as
-- `if(x = '', throwIf(true, ...), ...)`: the constant throwIf is folded and
-- fires on every row.
--
-- init/ runs only on a fresh server. Apply to an existing cluster with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/init/05-create-retention-functions.sql
CREATE OR REPLACE FUNCTION everrRetentionDays AS (resourceAttributes) ->
  toUInt16OrZero(resourceAttributes['everr.retention.days'])
    + throwIf(
        resourceAttributes['everr.retention.days'] = '',
        'everr.retention.days resource attribute missing'
      );

CREATE OR REPLACE FUNCTION everrStripRetention AS (resourceAttributes) ->
  mapFilter((k, v) -> k != 'everr.retention.days', resourceAttributes);
