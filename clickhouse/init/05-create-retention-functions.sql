-- Views read and strip the retention stamp through these shared functions.
-- Reject parsed zero so a missing or invalid stamp cannot expire rows silently.
-- Keep throwIf dependent on the row; a constant throwIf can fire during folding.
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

-- These JSON functions process inserted blocks, not storage reads. The app
-- column type strips the document path with SKIP; filter its keys array here.
CREATE OR REPLACE FUNCTION everrRetentionDaysJson AS (resourceAttributes) ->
  toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days')))
    + throwIf(
        toUInt16OrZero(toString(getSubcolumn(resourceAttributes, 'everr.retention.days'))) = 0,
        'everr.retention.days resource attribute missing or not a positive number of days'
      );

CREATE OR REPLACE FUNCTION everrStripRetentionKeys AS (keys) ->
  arrayFilter(k -> k != 'everr.retention.days', keys);
