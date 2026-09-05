#!/bin/bash
# Cut the write path over to direct ingest: otel.* become Null landing
# tables, the views stamp tenant_id and retention_days from the resource
# attributes the collector sets, the dictionary goes away.
#
# Every app.* table is rebuilt empty. There is no backfill.
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

# The app.* tables are rebuilt, not altered, and app.alert_events with them.
# Two reasons, either one enough on its own:
#
#   The tables that are live carry a TTL built from dictGetOrDefault. Any ALTER
#   re-validates that expression and fails with "TTL expression cannot contain
#   non-deterministic functions", so the codec and index blocks in init/10
#   cannot run against them at all.
#
#   The metrics sort key becomes (tenant_id, ServiceName, MetricName,
#   toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix) and TimeUnix
#   narrows to DateTime. ALTER can do neither: a sort key cannot be rewritten,
#   and the type of a column the sort key uses cannot change.
#
# CREATE TABLE IF NOT EXISTS is a no-op on a table that is already there, so
# without the drop init/10 would silently leave the old shape in place.
#
# Row policies and grants survive the drop, because ClickHouse keys access
# control by database and table name and not by the table UUID, so tenant
# isolation and the per-org /sql API users need no repair.

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

echo "1/3 guard: the collector must already stamp retention"
# One check per signal, not just logs: each pipeline has its own retention
# processor, so a config that stamps logs can still miss traces or metrics.
# After the cut-over an unstamped signal throws in its view and that signal
# stops ingesting, so catch it here while the tables still hold rows to read.
guard_signal() {
  run_sql "SELECT throwIf(
    (SELECT count() FROM otel.otel_${1} WHERE ${2} > now() - INTERVAL 10 MINUTE AND ResourceAttributes['everr.retention.days'] = '') > 0,
    '${1}: rows without everr.retention.days arrived in the last 10 minutes: deploy the collector first')"
}
guard_signal logs TimestampTime
guard_signal traces Timestamp
guard_signal metrics_gauge TimeUnix

echo "2/3 rebuild the tables, the landing tables and the views"
# The stored otel.* copies go with the tables. They hold seven days of raw
# rows that nothing reads: app.* is the read model.
trap drop_landing_tables ERR
# alert_events_logs_mv writes into app.logs, so it goes before app.logs does.
run_sql "DROP VIEW IF EXISTS app.alert_events_logs_mv"
for t in "${TABLES[@]}"; do
  run_sql "DROP VIEW IF EXISTS app.${t}_mv"
  run_sql "DROP TABLE IF EXISTS otel.otel_${t}"
  run_sql "DROP TABLE IF EXISTS app.${t}"
done
run_sql "DROP TABLE IF EXISTS app.alert_events"
run_file init/03-create-otel-tables.sql     # Null engines
run_file init/05-create-retention-functions.sql  # the stamp and the strip the views call
run_file init/10-create-mvs.sql             # app.* and their views
run_file init/12-create-alert-events.sql    # app.alert_events and its view into app.logs

# Every landing table must have its view back before ingestion resumes. Still
# under the trap: a landing table left Null with no view is the silent-discard
# state the trap exists to clear, so this check must not run outside it.
mv_names=$(printf ",'%s_mv'" "${TABLES[@]}")
run_sql "SELECT throwIf(
  (SELECT count() FROM system.tables
     WHERE database = 'app' AND engine = 'MaterializedView'
       AND name IN (${mv_names#,}, 'alert_events_logs_mv')) != $(( ${#TABLES[@]} + 1 )),
  'a table is missing its materialized view: rows would be discarded')"
trap - ERR

echo "3/3 remove the dictionary"
run_sql "DROP DICTIONARY IF EXISTS app.tenant_retention"
run_sql "DROP TABLE IF EXISTS app.tenant_retention_source"
run_sql "REVOKE dictGet ON app.tenant_retention FROM collector_rw, app_ro, web_app_admin" || true

echo "done"
run_sql "SELECT name, engine FROM system.tables WHERE database = 'otel' ORDER BY name FORMAT PrettyCompact"
run_sql "SELECT tenant_id, retention_days, count() FROM app.logs WHERE Timestamp > now() - INTERVAL 5 MINUTE GROUP BY ALL FORMAT PrettyCompact"
