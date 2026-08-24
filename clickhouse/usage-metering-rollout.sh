#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
clickhouse_client="${CLICKHOUSE_CLIENT_BIN:-clickhouse-client}"

usage() {
  cat <<'USAGE'
Usage:
  usage-metering-rollout.sh preflight [clickhouse-client arguments]
  usage-metering-rollout.sh apply [clickhouse-client arguments]
  usage-metering-rollout.sh validate-schema [clickhouse-client arguments]
  usage-metering-rollout.sh validate-data [clickhouse-client arguments]

Run preflight as the actual collector user and pass the collector DSN's
effective settings as client arguments. Run apply and both validation modes as
an administrative user.

validate-data requires these environment variables:
  USAGE_METERING_VALIDATION_TENANT_ID
  USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED=yes
  USAGE_METERING_VALIDATION_RUN_ID
  USAGE_METERING_VALIDATION_BUCKET   UTC hour, for example 2026-08-24 09:00:00

Pass connection options after the mode, for example:
  ./clickhouse/usage-metering-rollout.sh preflight \
    --host clickhouse.example.com --secure \
    --user collector_rw --password '<password>' \
    --async_insert=1 --wait_for_async_insert=1
USAGE
}

fail() {
  echo "usage metering rollout check failed: $*" >&2
  exit 1
}

assert_eq() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" != "$expected" ]]; then
    fail "$label: expected '$expected', got '$actual'"
  fi
}

[[ $# -ge 1 ]] || {
  usage >&2
  exit 2
}

mode="$1"
shift
client_args=("$@")

command -v "$clickhouse_client" >/dev/null 2>&1 ||
  fail "clickhouse client '$clickhouse_client' is not available"

ch() {
  local query="$1"
  shift
  "$clickhouse_client" "${client_args[@]}" "$@" \
    --format TSVRaw \
    --query "$query"
}

check_minimum_version() {
  local version major minor
  version="$(ch "SELECT version()")"
  IFS=. read -r major minor _rest <<< "$version"
  [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ ]] ||
    fail "could not parse ClickHouse version '$version'"
  if ((major < 26 || (major == 26 && minor < 1))); then
    fail "ClickHouse 26.1 or newer is required, got $version"
  fi
  echo "clickhouse_version=$version"
}

check_setting() {
  local name="$1"
  local expected="$2"
  local actual
  actual="$(ch "SELECT value FROM system.settings WHERE name = '$name'")"
  assert_eq "setting $name" "$expected" "$actual"
  echo "$name=$actual"
}

preflight() {
  check_minimum_version
  assert_eq "explicit UTC DateTime" "DateTime('UTC')" \
    "$(ch "SELECT toTypeName(now('UTC'))")"
  check_setting asterisk_include_materialized_columns 0
  check_setting materialized_views_ignore_errors 0
  check_setting async_insert 1
  check_setting wait_for_async_insert 1
  check_setting deduplicate_blocks_in_dependent_materialized_views 1
  echo "usage metering preflight passed"
}

apply_schema() {
  local started_at finished_at
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "usage_metering_apply_started_utc=$started_at"
  "$clickhouse_client" "${client_args[@]}" --multiquery \
    < "$script_dir/apply-usage-metering.sql"
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "usage_metering_apply_finished_utc=$finished_at"
  echo "The seven view-creation statements define the cutover inside this window."
}

validate_schema() {
  check_minimum_version
  assert_eq "usage ledger engine" "SummingMergeTree" \
    "$(ch "SELECT engine FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"
  assert_eq "usage ledger bucket type" "DateTime('UTC')" \
    "$(ch "SELECT type FROM system.columns WHERE database = 'app' AND table = 'tenant_usage' AND name = 'bucket'")"
  assert_eq "usage ledger partition key" "toYYYYMM(bucket)" \
    "$(ch "SELECT partition_key FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"
  assert_eq "usage ledger sorting key" "tenant_id, bucket, meter" \
    "$(ch "SELECT sorting_key FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"
  assert_eq "usage ledger has no TTL" "1" \
    "$(ch "SELECT positionCaseInsensitive(create_table_query, ' TTL ') = 0 FROM system.tables WHERE database = 'app' AND name = 'tenant_usage'")"
  assert_eq "metering materialized view count" "7" \
    "$(ch "SELECT count() FROM system.tables WHERE database = 'app' AND name LIKE 'tenant_usage%_mv'")"
  assert_eq "materialized RowBytes column count" "7" \
    "$(ch "SELECT count() FROM system.columns WHERE database = 'otel' AND name = 'RowBytes' AND default_kind = 'MATERIALIZED' AND startsWith(default_expression, 'byteSize(')")"

  local policy
  policy="$(ch "SHOW CREATE ROW POLICY tenant_filter_tenant_usage ON app.tenant_usage")"
  [[ "$policy" == *"USING tenant_id = getSetting('SQL_everr_tenant_id')"* ]] ||
    fail "tenant usage row policy has the wrong predicate"
  [[ "$policy" == *"TO app_ro"* ]] ||
    fail "tenant usage row policy is not assigned to app_ro"

  echo "usage metering schema validation passed"
}

validate_data() {
  : "${USAGE_METERING_VALIDATION_TENANT_ID:?validation tenant id is required}"
  : "${USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED:?dedicated validation tenant confirmation is required}"
  : "${USAGE_METERING_VALIDATION_RUN_ID:?validation run id is required}"
  : "${USAGE_METERING_VALIDATION_BUCKET:?validation UTC bucket is required}"
  [[ "$USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED" == "yes" ]] ||
    fail "USAGE_METERING_VALIDATION_TENANT_IS_DEDICATED must be 'yes'"

  local params=(
    "--param_tenant=$USAGE_METERING_VALIDATION_TENANT_ID"
    "--param_run_id=$USAGE_METERING_VALIDATION_RUN_ID"
    "--param_bucket=$USAGE_METERING_VALIDATION_BUCKET"
  )
  local traces_raw logs_raw metrics_raw traces_ledger logs_ledger metrics_ledger

  traces_raw="$(ch "
    SELECT sum(RowBytes), count()
    FROM otel.otel_traces
    WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
      AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
  " "${params[@]}")"
  logs_raw="$(ch "
    SELECT sum(RowBytes), count()
    FROM otel.otel_logs
    WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
      AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
  " "${params[@]}")"
  metrics_raw="$(ch "
    SELECT sum(bytes), sum(items)
    FROM
    (
      SELECT sum(RowBytes) AS bytes, count() AS items
      FROM otel.otel_metrics_gauge
      WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
        AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
      UNION ALL
      SELECT sum(RowBytes), count()
      FROM otel.otel_metrics_sum
      WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
        AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
      UNION ALL
      SELECT sum(RowBytes), count()
      FROM otel.otel_metrics_histogram
      WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
        AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
      UNION ALL
      SELECT sum(RowBytes), count()
      FROM otel.otel_metrics_exponential_histogram
      WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
        AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
      UNION ALL
      SELECT sum(RowBytes), count()
      FROM otel.otel_metrics_summary
      WHERE ResourceAttributes['everr.tenant.id'] = {tenant:String}
        AND ResourceAttributes['everr.usage.validation.run_id'] = {run_id:String}
    )
  " "${params[@]}")"

  traces_ledger="$(ch "SELECT sum(bytes), sum(items) FROM app.tenant_usage WHERE tenant_id = {tenant:String} AND meter = 'traces' AND bucket = {bucket:DateTime('UTC')}" "${params[@]}")"
  logs_ledger="$(ch "SELECT sum(bytes), sum(items) FROM app.tenant_usage WHERE tenant_id = {tenant:String} AND meter = 'logs' AND bucket = {bucket:DateTime('UTC')}" "${params[@]}")"
  metrics_ledger="$(ch "SELECT sum(bytes), sum(items) FROM app.tenant_usage WHERE tenant_id = {tenant:String} AND meter = 'metrics' AND bucket = {bucket:DateTime('UTC')}" "${params[@]}")"

  local _bytes items
  IFS=$'\t' read -r _bytes items <<< "$traces_raw"
  ((items > 0)) || fail "no tagged trace rows found"
  IFS=$'\t' read -r _bytes items <<< "$logs_raw"
  ((items > 0)) || fail "no tagged log rows found"
  IFS=$'\t' read -r _bytes items <<< "$metrics_raw"
  ((items > 0)) || fail "no tagged metric rows found"

  assert_eq "trace ledger totals" "$traces_raw" "$traces_ledger"
  assert_eq "log ledger totals" "$logs_raw" "$logs_ledger"
  assert_eq "metric ledger totals" "$metrics_raw" "$metrics_ledger"
  echo "usage metering per-signal data validation passed"
}

case "$mode" in
  preflight) preflight ;;
  apply) apply_schema ;;
  validate-schema) validate_schema ;;
  validate-data) validate_data ;;
  -h | --help | help) usage ;;
  *)
    usage >&2
    fail "unknown mode '$mode'"
    ;;
esac
