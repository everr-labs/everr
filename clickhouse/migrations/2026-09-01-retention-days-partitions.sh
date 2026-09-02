#!/bin/bash
# Rebuild the app.* tables so every row carries `retention_days`, partitions
# by (day, retention_days), and expires by whole-part drop. Partition key and
# TTL are immutable, so the tables are dropped and recreated. Existing app.*
# rows are lost; the raw otel.* tables are untouched and keep their own TTL.
#
# Usage (from the repo root, as an admin user):
#   clickhouse/migrations/2026-09-01-retention-days-partitions.sh --user default --password '<ADMIN_PASSWORD>'
# CLICKHOUSE_CLIENT overrides the client binary, e.g. for a container:
#   CLICKHOUSE_CLIENT='docker exec -i everr-clickhouse-1 clickhouse-client' ...
#
# Sequence:
#   1. drop the materialized views, so nothing writes into the tables while
#      they are recreated;
#   2. drop every app.* data table;
#   3. run the init scripts, which recreate the tables with the new key and
#      the views that stamp retention_days.
#
# Rows the collector writes into otel.* between step 1 and the end of step 3
# (well under a second) are not projected into app.*. Inserts into
# app.alert_events fail in the same window.
set -euo pipefail

cd "$(dirname "$0")/.."

client() {
  # shellcheck disable=SC2086
  ${CLICKHOUSE_CLIENT:-clickhouse-client} "$@"
}

run_sql() {
  client "${CLIENT_ARGS[@]}" --multiquery --query "$1"
}

run_file() {
  client "${CLIENT_ARGS[@]}" --multiquery < "$1"
}

CLIENT_ARGS=("$@")

SIGNAL_TABLES=(traces logs metrics_gauge metrics_sum metrics_histogram metrics_exponential_histogram metrics_summary)

echo "1/3 drop materialized views"
for t in "${SIGNAL_TABLES[@]}"; do
  run_sql "DROP VIEW IF EXISTS app.${t}_mv"
done
run_sql "DROP VIEW IF EXISTS app.alert_events_logs_mv"

echo "2/3 drop tables"
for t in "${SIGNAL_TABLES[@]}" alert_events; do
  run_sql "DROP TABLE IF EXISTS app.${t}"
done

echo "3/3 recreate tables and views from init/"
run_file init/10-create-mvs.sql
# The source table predates the UInt16 columns; the CREATE above is a no-op
# on it. The dictionary keeps its UInt32 attributes until it is recreated in
# everr-deploy (see docs/clickhouse-retention-rollout.md); dictGetOrDefault
# accepts a UInt16 default against a UInt32 attribute, so the views work in
# the meantime.
run_sql "ALTER TABLE app.tenant_retention_source MODIFY COLUMN traces_days UInt16, MODIFY COLUMN logs_days UInt16, MODIFY COLUMN metrics_days UInt16"
run_file init/12-create-alert-events.sql
run_file init/20-apply-rls.sql
# The raw logs table is not rebuilt; give TimestampTime the codec init/03 now
# declares so both copies match. New parts pick it up, old ones on merge.
run_sql "ALTER TABLE otel.otel_logs MODIFY COLUMN TimestampTime DateTime DEFAULT toDateTime(Timestamp) CODEC(Delta(4), ZSTD(1))"
run_sql "SYSTEM RELOAD DICTIONARY app.tenant_retention"

echo "done"
run_sql "SELECT name, partition_key FROM system.tables WHERE database = 'app' AND engine LIKE '%MergeTree%' ORDER BY name FORMAT PrettyCompact"
