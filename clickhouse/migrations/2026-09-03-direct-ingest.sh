#!/bin/bash
# Cut the write path over to direct ingest: otel.* become Null landing
# tables, the views stamp tenant_id and retention_days from the resource
# attributes the collector sets, the dictionary goes away. app.* is untouched.
#
# Run AFTER the app and the collector that stamp everr.retention.* are
# deployed. Per table there is a sub-second window between dropping the old
# view and creating the new one in which exporter inserts fail; the exporter
# retries them.
#
# Usage (from the repo root, as an admin user):
#   clickhouse/migrations/2026-09-03-direct-ingest.sh --host <h> --secure --user default --password '<pw>'
# CLICKHOUSE_CLIENT overrides the client binary, e.g. for a container:
#   CLICKHOUSE_CLIENT='docker exec -i everr-clickhouse-1 clickhouse-client' ...
set -Eeuo pipefail

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

TABLES=(traces logs metrics_gauge metrics_sum metrics_histogram metrics_exponential_histogram metrics_summary)

# The metrics tables are rebuilt, not altered. Their sort key becomes
# (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix),
# cityHash64(Attributes), TimeUnix) and TimeUnix narrows from DateTime64(9) to
# DateTime. ALTER can do neither: a sort key cannot be rewritten, and the type
# of a column the sort key uses cannot change. Stored metrics history goes;
# app.logs and app.traces keep theirs. Row policies and grants survive the
# drop because ClickHouse keys them by database and table name, not by the
# table UUID, so tenant isolation and the per-org /sql API users are unharmed.
REBUILD=(metrics_gauge metrics_sum metrics_histogram metrics_exponential_histogram metrics_summary)

# After the landing tables become Null and before their views exist, an insert
# is accepted and discarded. If the swap stops half way, drop the Null tables
# that have no view: the exporter then gets an error it retries instead of
# losing the data quietly.
drop_landing_tables() {
  echo "swap failed: dropping landing tables that have no view, so ingestion fails loudly" >&2
  for t in "${TABLES[@]}"; do
    run_sql "DROP TABLE IF EXISTS otel.otel_${t}" || true
  done
}

echo "1/4 guard: the collector must already stamp retention"
run_sql "SELECT throwIf(
  (SELECT count() FROM otel.otel_logs WHERE TimestampTime > now() - INTERVAL 10 MINUTE AND ResourceAttributes['everr.retention.logs_days'] = '') > 0,
  'rows without everr.retention.logs_days arrived in the last 10 minutes: deploy the collector first')"

echo "2/4 swap landing tables and views"
# The stored otel.* copies go with the tables. They hold seven days of raw
# rows that nothing reads: app.* is the read model.
trap drop_landing_tables ERR
for t in "${TABLES[@]}"; do
  run_sql "DROP VIEW IF EXISTS app.${t}_mv"
  run_sql "DROP TABLE IF EXISTS otel.otel_${t}"
done
for t in "${REBUILD[@]}"; do
  run_sql "DROP TABLE IF EXISTS app.${t}"
done
run_file init/03-create-otel-tables.sql   # Null engines
run_file init/10-create-mvs.sql           # app.* CREATE IF NOT EXISTS rebuilds the metrics tables; views are recreated
trap - ERR

# Every landing table must have its view back before ingestion resumes.
mv_names=$(printf ",'%s_mv'" "${TABLES[@]}")
run_sql "SELECT throwIf(
  (SELECT count() FROM system.tables
     WHERE database = 'app' AND engine = 'MaterializedView' AND name IN (${mv_names#,})) != ${#TABLES[@]},
  'a landing table has no materialized view: rows would be discarded')"

echo "3/4 alert events keep their retention from the app"
# REMOVE DEFAULT, not MODIFY COLUMN ... UInt16: a modify that does not name a
# default keeps the one the column has, and the dictionary then still has a
# dependent table and cannot be dropped in step 4.
# Safe in either order: the app deploy that writes retention_days explicitly
# comes first, and the old DEFAULT still works until this runs.
run_sql "ALTER TABLE app.alert_events MODIFY COLUMN retention_days REMOVE DEFAULT"

echo "4/4 remove the dictionary"
run_sql "DROP DICTIONARY IF EXISTS app.tenant_retention"
run_sql "DROP TABLE IF EXISTS app.tenant_retention_source"
run_sql "REVOKE dictGet ON app.tenant_retention FROM collector_rw, web_app_admin" || true

echo "done"
run_sql "SELECT name, engine FROM system.tables WHERE database = 'otel' ORDER BY name FORMAT PrettyCompact"
run_sql "SELECT tenant_id, retention_days, count() FROM app.logs WHERE TimestampTime > now() - INTERVAL 5 MINUTE GROUP BY ALL FORMAT PrettyCompact"
