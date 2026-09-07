-- Per-row retention, expressed once. Every app.* materialized view reads the
-- window the collector stamped on the resource and strips the attribute before
-- storage; centralized as UDFs so the two rules live in one place instead of a
-- copy in each of the seven views.
--
-- everrRetentionDays refuses a row whose window is missing or unusable. Both
-- cases stamp 0, and a 0 expires the row at insert with no error anywhere, so
-- the guard tests the parsed number rather than the raw string: that also
-- catches a value that is present but not a plain 1..65535 (a unit suffix, a
-- literal '0', anything above UInt16). Write it as
-- `toUInt16OrZero(x) + throwIf(toUInt16OrZero(x) = 0, ...)`, never as
-- `if(x = '', throwIf(true, ...), ...)`: the constant throwIf is folded and
-- fires on every row.
--
-- init/ runs only on a fresh server. Apply to an existing cluster with:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/init/05-create-retention-functions.sql
CREATE OR REPLACE FUNCTION everrRetentionDays AS (resourceAttributes) ->
  toUInt16OrZero(resourceAttributes['everr.retention.days'])
    + throwIf(
        toUInt16OrZero(resourceAttributes['everr.retention.days']) = 0,
        'everr.retention.days resource attribute missing or not a positive number of days'
      );

CREATE OR REPLACE FUNCTION everrStripRetention AS (resourceAttributes) ->
  mapFilter((k, v) -> k != 'everr.retention.days', resourceAttributes);

-- The JSON forms for app.logs and app.traces. getSubcolumn on a block that
-- is already in memory costs nothing on disk, and it avoids the question of
-- how `x.`path`` resolves against a lambda parameter. toString accepts the
-- stamp as a string or as a number and gives '' for a missing path, so the
-- guard below is the same test as in everrRetentionDays. The strip of the
-- document itself is the SKIP on the app table's column type; only the keys
-- array needs a filter.
CREATE OR REPLACE FUNCTION everrRetentionDaysJson AS (resourceAttributes) ->
  toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days')))
    + throwIf(
        toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days'))) = 0,
        'everr.retention.days resource attribute missing or not a positive number of days'
      );

CREATE OR REPLACE FUNCTION everrStripRetentionKeys AS (keys) ->
  arrayFilter(k -> k != 'everr.retention.days', keys);
