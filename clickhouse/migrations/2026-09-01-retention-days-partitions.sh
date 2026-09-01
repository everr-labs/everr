#!/bin/bash
# Rebuild the app.* tables so every row carries `retention_days`, partitions
# by (day, retention_days), and expires by whole-part drop. Partition key and
# TTL are immutable, so the tables are recreated and backfilled.
#
# Usage (from the repo root, as an admin user):
#   clickhouse/migrations/2026-09-01-retention-days-partitions.sh --user default --password '<ADMIN_PASSWORD>'
# CLICKHOUSE_CLIENT overrides the client binary, e.g. for a container:
#   CLICKHOUSE_CLIENT='docker exec -i everr-clickhouse-1 clickhouse-client' ...
# KEEP_OLD=1 skips step 5 so the *_old tables stay for verification; drop them
# by hand afterwards (they are readable by app_ro until then).
#
# Sequence:
#   1. drop the materialized views, so nothing writes into the tables while
#      they move;
#   2. rename every app.* data table to app.<name>_old (one atomic statement);
#   3. run the init scripts, which recreate the tables with the new key and
#      the views that stamp retention_days;
#   4. backfill from the _old tables, stamping each row with the tenant's
#      current retention (rows already past it are dropped by the TTL at
#      insert, which is the one-time rescue of the current plans);
#   5. drop the _old tables.
#
# Rows the collector writes into otel.* between step 1 and the end of step 3
# (well under a second) are not projected into app.*. Run it while ingestion
# is low if that matters.
#
# Row policies and grants are bound to table names, so they stay on app.<name>
# and never apply to the _old copies; the _old copies are readable by app_ro
# until step 5, which is why the script drops them without asking.
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

echo "1/5 drop materialized views"
for t in "${SIGNAL_TABLES[@]}"; do
  run_sql "DROP VIEW IF EXISTS app.${t}_mv"
done
run_sql "DROP VIEW IF EXISTS app.alert_events_logs_mv"

echo "2/5 rename current tables to *_old"
rename=""
for t in "${SIGNAL_TABLES[@]}" alert_events; do
  rename+="${rename:+, }app.${t} TO app.${t}_old"
done
run_sql "RENAME TABLE ${rename}"

echo "3/5 recreate tables and views from init/"
run_file init/05-create-retention-function.sql
run_file init/10-create-mvs.sql
run_file init/12-create-alert-events.sql
run_file init/20-apply-rls.sql

echo "4/5 backfill"
# Column order: the new tables have the old columns in the same order plus
# retention_days at the end, so a positional INSERT ... SELECT *, <stamp> lines
# up. The stamp reads the dictionary the same way the views do.
stamp() { # $1 = dictionary attribute, $2 = free-tier fallback
  echo "everrRetentionDays(dictGetOrDefault('app.tenant_retention', '$1', tenant_id, toUInt32($2)))"
}
run_sql "SYSTEM RELOAD DICTIONARY app.tenant_retention"
# alert_events first: its logs projection view is live again, so the backfill
# re-projects alert history into app.logs with the right stamp, and the logs
# backfill below skips the projections that app.logs_old already holds.
run_sql "INSERT INTO app.alert_events SELECT *, $(stamp logs_days 7) FROM app.alert_events_old"
run_sql "INSERT INTO app.traces SELECT *, $(stamp traces_days 7) FROM app.traces_old"
run_sql "INSERT INTO app.logs SELECT *, $(stamp logs_days 7) FROM app.logs_old WHERE ScopeName != 'everr.alerting'"
for t in metrics_gauge metrics_sum metrics_histogram metrics_exponential_histogram metrics_summary; do
  run_sql "INSERT INTO app.${t} SELECT *, $(stamp metrics_days 14) FROM app.${t}_old"
done

if [[ "${KEEP_OLD:-0}" == "1" ]]; then
  echo "5/5 keeping *_old tables (KEEP_OLD=1)"
else
  echo "5/5 drop *_old"
  for t in "${SIGNAL_TABLES[@]}" alert_events; do
    run_sql "DROP TABLE app.${t}_old"
  done
fi

echo "done"
run_sql "SELECT table, uniq(partition) AS partitions, count() AS parts, sum(rows) AS rows FROM system.parts WHERE active AND database = 'app' GROUP BY table ORDER BY table FORMAT PrettyCompact"
