#!/bin/bash
# Move every app.* table to the partition key in init/10-create-mvs.sql:
# (retention_days, bucket), where a window of 90 days or less gets a part per
# day and a longer window a part per month.
#
# A partition key cannot be altered, so each table is rebuilt and its rows are
# copied. Per table: rename the live table aside, recreate it from init/10
# under the new key, copy the rows that are still inside their window, then
# drop the old table. The views write to the table name, so after the rename
# they fail until the recreate a moment later; the exporter retries those
# inserts. Rows that arrive after the recreate land in the new table, and the
# old table is frozen, so nothing is lost or copied twice. Rows already past
# their window are not copied: the TTL would drop them on the next merge.
#
# The copy needs free disk for a second copy of the largest table and reads
# every row once; budget the run for the biggest table's size.
#
# Usage (from the repo root, as an admin user):
#   clickhouse/migrations/2026-09-05-partition-buckets.sh --host <h> --secure --user default --password '<pw>'
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

# table:time column. The window predicate mirrors the TTL expression.
TABLES=(
  traces:Timestamp
  logs:Timestamp
  metrics_gauge:TimeUnix
  metrics_sum:TimeUnix
  metrics_histogram:TimeUnix
  metrics_exponential_histogram:TimeUnix
  metrics_summary:TimeUnix
)

NEW_KEY="if(retention_days > 90, toStartOfMonth"

echo "0/2 guard: skip tables that already carry the new key, refuse a half-done run"
for entry in "${TABLES[@]}"; do
  t=${entry%%:*}
  run_sql "SELECT throwIf(
    (SELECT count() FROM system.tables WHERE database = 'app' AND name = '${t}_old') > 0,
    'app.${t}_old exists: a previous run stopped before dropping it. Compare it with app.${t} and drop it by hand, then rerun') FORMAT Null"
done

for entry in "${TABLES[@]}"; do
  t=${entry%%:*}
  col=${entry##*:}
  window="toDate(${col}) + toIntervalDay(retention_days) > today()"

  if [[ "$(run_sql "SELECT partition_key FROM system.tables WHERE database = 'app' AND name = '${t}'")" == *"${NEW_KEY}"* ]]; then
    echo "app.${t}: already on the new key, skipped"
    continue
  fi

  echo "1/2 app.${t}: rename aside and recreate under the new key"
  run_sql "RENAME TABLE app.${t} TO app.${t}_old"
  # CREATE TABLE IF NOT EXISTS recreates only the table that is missing; the
  # other statements in the file are no-ops on tables that already exist.
  run_file init/10-create-mvs.sql
  run_sql "SELECT throwIf(
    position((SELECT partition_key FROM system.tables WHERE database = 'app' AND name = '${t}'), '${NEW_KEY}') = 0,
    'app.${t} was recreated without the new partition key') FORMAT Null"

  echo "2/2 app.${t}: copy the rows inside their window, then drop the old table"
  # Copy by column name, not by position, so a column the old table lacks
  # fails the insert instead of shifting values into the wrong column.
  cols=$(run_sql "SELECT arrayStringConcat(groupArray(concat('\`', name, '\`')), ', ')
    FROM system.columns
    WHERE database = 'app' AND table = '${t}' AND default_kind NOT IN ('ALIAS', 'MATERIALIZED')")
  run_sql "INSERT INTO app.${t} (${cols}) SELECT ${cols} FROM app.${t}_old WHERE ${window}"
  run_sql "SELECT throwIf(
    (SELECT count() FROM app.${t} WHERE ${window}) < (SELECT count() FROM app.${t}_old WHERE ${window}),
    'app.${t}: the copy holds fewer rows than app.${t}_old; both tables are kept') FORMAT Null"
  run_sql "DROP TABLE app.${t}_old"
done

echo "done"
run_sql "SELECT name, partition_key FROM system.tables WHERE database = 'app' AND engine = 'MergeTree' ORDER BY name FORMAT PrettyCompact"
run_sql "SELECT table, count() AS partitions, sum(rows) AS rows FROM system.parts WHERE database = 'app' AND active GROUP BY table ORDER BY table FORMAT PrettyCompact"
